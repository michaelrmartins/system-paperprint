import { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import { findOrCreateStudent } from '../services/studentService.js';
import * as situatorClient from '../clients/situatorClient.js';
import * as vectorAIClient from '../clients/vectorAIClient.js';
import * as lyceumClient from '../clients/lyceumClient.js';
import { db } from '../db/knex.js';

const TODAY_EXPR = `DATE(print_operations.created_at AT TIME ZONE 'America/Sao_Paulo') = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date`;

export async function studentRoutes(app: FastifyInstance) {
  // Identify by manual registration number — contingency allowed when Lyceum is down
  app.post('/students/identify/manual', { preHandler: requireAuth(['operator', 'admin']) }, async (req, reply) => {
    const { registration_number } = req.body as { registration_number: string };
    if (!registration_number?.trim()) {
      return reply.status(400).send({ error: 'MISSING_REGISTRATION_NUMBER' });
    }
    try {
      return await findOrCreateStudent(registration_number.trim(), { strict: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'STUDENT_NOT_FOUND') return reply.status(404).send({ error: 'STUDENT_NOT_FOUND' });
      throw err;
    }
  });

  // Identify by RFID card hex — contingency allowed
  app.post('/students/identify/rfid', { preHandler: requireAuth(['operator', 'admin']) }, async (req, reply) => {
    const { card_hex } = req.body as { card_hex: string };
    if (!card_hex?.trim()) return reply.status(400).send({ error: 'MISSING_CARD_HEX' });

    let person;
    try {
      person = await situatorClient.getPersonByCardHex(card_hex.trim());
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'CARD_NOT_FOUND' || msg.includes('HTTP 404')) {
        return reply.status(404).send({ error: 'CARD_NOT_FOUND' });
      }
      return reply.status(503).send({ error: 'SITUATOR_UNAVAILABLE' });
    }

    if (!person.Active) return reply.status(403).send({ error: 'STUDENT_INACTIVE' });
    if (!person.Document) return reply.status(422).send({ error: 'DOCUMENT_NOT_FOUND' });

    try {
      return await findOrCreateStudent(person.Document, { strict: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'STUDENT_NOT_FOUND') return reply.status(404).send({ error: 'STUDENT_NOT_FOUND' });
      throw err;
    }
  });

  // Identify by facial recognition — contingency allowed
  app.post('/students/identify/facial', { preHandler: requireAuth(['operator', 'admin']) }, async (req, reply) => {
    const { image } = req.body as { image: string };
    if (!image) return reply.status(400).send({ error: 'MISSING_IMAGE' });

    let recognition;
    try {
      recognition = await vectorAIClient.recognizeFace(image);
    } catch {
      return reply.status(503).send({ error: 'VECTOR_AI_UNAVAILABLE' });
    }

    if (!recognition) return reply.status(422).send({ error: 'FACE_NOT_RECOGNIZED' });

    try {
      const result = await findOrCreateStudent(recognition.matricula, { strict: false });
      return { ...result, confidence: recognition.confidence };
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'STUDENT_NOT_FOUND') return reply.status(404).send({ error: 'STUDENT_NOT_FOUND' });
      throw err;
    }
  });

  // Today's printed students — enriched with loan indicators
  app.get('/students/today', { preHandler: requireAuth(['operator', 'auditor', 'admin']) }, async () => {
    // Quota debits: who had their balance reduced today
    const debitRows = await db('entries')
      .join('print_operations', 'entries.print_operation_id', 'print_operations.id')
      .join('students', 'entries.student_id', 'students.id')
      .whereRaw(TODAY_EXPR)
      .groupBy('students.id', 'students.name', 'students.registration_number', 'students.course', 'students.period')
      .select(
        'students.id',
        'students.name',
        'students.registration_number',
        'students.course',
        'students.period',
        db.raw('SUM(entries.sheets) as quota_used'),
        db.raw("SUM(CASE WHEN entries.type = 'borrowed' THEN entries.sheets ELSE 0 END) as sheets_lent"),
        db.raw('MAX(print_operations.created_at) as last_operation_at')
      )
      .orderBy('last_operation_at', 'desc') as Array<{
        id: number; name: string; registration_number: string; course: string; period: string;
        quota_used: string; sheets_lent: string; last_operation_at: string;
      }>;

    // Primary operations: who actually printed (total_sheets including borrowed)
    const primaryRows = await db('print_operations')
      .join('students', 'print_operations.student_id', 'students.id')
      .whereRaw(TODAY_EXPR)
      .groupBy('students.id')
      .select('students.id', db.raw('SUM(print_operations.total_sheets) as total_printed')) as Array<{ id: number; total_printed: string }>;

    // Operations that had borrowed entries → primary student received loans
    const receivedLoanOps = await db('entries')
      .join('print_operations', 'entries.print_operation_id', 'print_operations.id')
      .whereRaw(TODAY_EXPR)
      .where('entries.type', 'borrowed')
      .distinct('print_operations.student_id') as Array<{ student_id: number }>;

    // Most recent identify_method per primary student today
    const methodRows = await db('print_operations')
      .whereRaw(`DATE(print_operations.created_at AT TIME ZONE 'America/Sao_Paulo') = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date`)
      .orderBy('print_operations.created_at', 'desc')
      .select('student_id', 'identify_method') as Array<{ student_id: number; identify_method: string }>;

    const methodMap = new Map<number, string>();
    for (const row of methodRows) {
      if (!methodMap.has(row.student_id)) methodMap.set(row.student_id, row.identify_method);
    }

    const receivedLoanIds = new Set(receivedLoanOps.map((r) => r.student_id));
    const primaryMap = new Map(primaryRows.map((r) => [r.id, parseInt(r.total_printed)]));

    return debitRows.map((r) => ({
      id: r.id,
      registration_number: r.registration_number,
      name: r.name,
      course: r.course,
      period: r.period,
      quota_used: parseInt(r.quota_used),
      sheets_lent: parseInt(r.sheets_lent) || 0,
      total_printed: primaryMap.get(r.id) ?? parseInt(r.quota_used),
      gave_loans: (parseInt(r.sheets_lent) || 0) > 0,
      received_loans: receivedLoanIds.has(r.id),
      last_operation_at: r.last_operation_at,
      identify_method: methodMap.get(r.id) ?? null,
    }));
  });

  // Full history: quota debits + primary operations (to show borrowed portions)
  app.get('/students/:id/full-history', { preHandler: requireAuth(['operator', 'auditor', 'admin']) }, async (req) => {
    const studentId = parseInt((req.params as { id: string }).id);
    const { date } = req.query as { date?: string };

    const dateFilter = (col: string) =>
      date
        ? `DATE(${col} AT TIME ZONE 'America/Sao_Paulo') = '${date}'`
        : `DATE(${col} AT TIME ZONE 'America/Sao_Paulo') <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date`;

    // Operations where this student was primary — full entry breakdown
    const operations = await db('print_operations')
      .join('system_users', 'print_operations.operator_id', 'system_users.id')
      .where('print_operations.student_id', studentId)
      .whereRaw(dateFilter('print_operations.created_at'))
      .select(
        'print_operations.id',
        'print_operations.total_sheets',
        'print_operations.status',
        'print_operations.created_at',
        'system_users.login as operator_login'
      )
      .orderBy('print_operations.created_at', 'desc');

    const opIds = operations.map((o) => o.id);
    const allEntries = opIds.length
      ? await db('entries')
          .join('students', 'entries.student_id', 'students.id')
          .whereIn('entries.print_operation_id', opIds)
          .select('entries.*', 'students.name as student_name', 'students.registration_number')
      : [];

    const entriesByOp = new Map<number, typeof allEntries>();
    for (const e of allEntries) {
      const arr = entriesByOp.get(e.print_operation_id) ?? [];
      arr.push(e);
      entriesByOp.set(e.print_operation_id, arr);
    }

    const asPrimary = operations.map((op) => ({
      ...op,
      entries: entriesByOp.get(op.id) ?? [],
      own_sheets: (entriesByOp.get(op.id) ?? []).filter((e) => e.student_id === studentId).reduce((s, e) => s + e.sheets, 0),
      borrowed_sheets: (entriesByOp.get(op.id) ?? []).filter((e) => e.student_id !== studentId).reduce((s, e) => s + e.sheets, 0),
    }));

    // Entries where this student's quota was used in someone else's operation
    const loanEntries = await db('entries')
      .join('print_operations', 'entries.print_operation_id', 'print_operations.id')
      .join('students as primary_s', 'print_operations.student_id', 'primary_s.id')
      .join('system_users', 'print_operations.operator_id', 'system_users.id')
      .where('entries.student_id', studentId)
      .where('entries.type', 'borrowed')
      .whereRaw(dateFilter('print_operations.created_at'))
      .select(
        'entries.id',
        'entries.sheets',
        'entries.created_at',
        'print_operations.id as operation_id',
        'print_operations.total_sheets as operation_total',
        'primary_s.name as primary_student_name',
        'primary_s.registration_number as primary_registration',
        'system_users.login as operator_login'
      )
      .orderBy('entries.created_at', 'desc');

    return { as_primary: asPrimary, as_lender: loanEntries };
  });

  // Photo for a student — Lyceum already caches with Redis, so no DB caching needed
  app.get('/students/:id/photo', { preHandler: requireAuth(['operator', 'auditor', 'admin']) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const student = await db('students').where('id', parseInt(id)).first();
    if (!student) return reply.status(404).send({ error: 'NOT_FOUND' });
    if (!student.person_code) return { photo: null };
    try {
      const photo = await lyceumClient.getStudentPhoto(student.person_code);
      return { photo };
    } catch {
      return { photo: null };
    }
  });

  // Simple entry history (used by reports)
  app.get('/students/:id/history', { preHandler: requireAuth(['operator', 'auditor', 'admin']) }, async (req) => {
    const { id } = req.params as { id: string };
    const { date } = req.query as { date?: string };

    const query = db('entries')
      .join('print_operations', 'entries.print_operation_id', 'print_operations.id')
      .join('system_users', 'print_operations.operator_id', 'system_users.id')
      .where('entries.student_id', parseInt(id))
      .select(
        'entries.id',
        'entries.sheets',
        'entries.type',
        'entries.created_at',
        'print_operations.id as operation_id',
        'print_operations.status',
        'print_operations.total_sheets',
        'system_users.login as operator_login'
      )
      .orderBy('entries.created_at', 'desc');

    if (date) {
      query.whereRaw(`DATE(print_operations.created_at AT TIME ZONE 'America/Sao_Paulo') = ?`, [date]);
    }

    return query;
  });
}
