import { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import { findOrCreateStudent } from '../services/studentService.js';
import { findOrCreateEmployee } from '../services/employeeService.js';
import { detectUserType } from '../lib/documentUtils.js';
import * as situatorClient from '../clients/situatorClient.js';
import * as vectorAIClient from '../clients/vectorAIClient.js';
import * as lyceumClient from '../clients/lyceumClient.js';
import { db } from '../db/knex.js';
import { JwtPayload } from '../types/index.js';

const TODAY_EXPR = `DATE(print_operations.created_at AT TIME ZONE 'America/Sao_Paulo') = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date`;

async function logInvalidDocument(
  document: string,
  situationDetail: string,
  context: 'primary' | 'loan',
  identifyMethod: 'manual' | 'rfid' | 'facial',
  operatorId: number,
  primaryStudentId?: number | null,
) {
  await db('invalid_document_attempts').insert({
    document,
    situation_detail: situationDetail,
    context,
    identify_method: identifyMethod,
    operator_id: operatorId,
    primary_student_id: primaryStudentId ?? null,
  });
}

export async function studentRoutes(app: FastifyInstance) {
  // Identify by manual registration number — contingency allowed when Lyceum is down
  app.post('/students/identify/manual', { preHandler: requireAuth(['operator', 'admin']) }, async (req, reply) => {
    const { registration_number } = req.body as { registration_number: string };
    const { force, context = 'primary', primary_student_id } = req.query as { force?: string; context?: string; primary_student_id?: string };
    if (!registration_number?.trim()) {
      return reply.status(400).send({ error: 'MISSING_REGISTRATION_NUMBER' });
    }
    const reg = registration_number.trim();
    const operator = req.user as JwtPayload;

    const enrollmentStatus = await lyceumClient.getStudentEnrollmentStatus(reg);
    if (enrollmentStatus !== null && enrollmentStatus !== 'Matriculado') {
      const primaryId = primary_student_id ? parseInt(primary_student_id) : null;
      await logInvalidDocument(reg, enrollmentStatus, context === 'loan' ? 'loan' : 'primary', 'manual', operator.sub, primaryId);
      return reply.status(403).send({ error: 'STUDENT_NOT_ENROLLED', situation_detail: enrollmentStatus });
    }

    try {
      return await findOrCreateStudent(reg, { strict: false, force: force === 'true' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'STUDENT_NOT_IN_LYCEUM') return reply.status(422).send({ error: 'STUDENT_NOT_IN_LYCEUM', registration_number: reg });
      if (msg === 'STUDENT_NOT_FOUND') return reply.status(404).send({ error: 'STUDENT_NOT_FOUND' });
      throw err;
    }
  });

  // Identify by RFID card hex — routes to employee service when Document is not student format
  app.post('/students/identify/rfid', { preHandler: requireAuth(['operator', 'admin']) }, async (req, reply) => {
    const { card_hex } = req.body as { card_hex: string };
    const { force, context = 'primary', primary_student_id } = req.query as { force?: string; context?: string; primary_student_id?: string };
    if (!card_hex?.trim()) return reply.status(400).send({ error: 'MISSING_CARD_HEX' });
    const operator = req.user as JwtPayload;

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

    const doc = person.Document;

    // Route to employee service when Document is not student format
    if (detectUserType(doc) === 'employee') {
      try {
        return await findOrCreateEmployee(doc, { strict: false, force: force === 'true' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg === 'EMPLOYEE_NOT_IN_NASAJON') return reply.status(422).send({ error: 'EMPLOYEE_NOT_IN_NASAJON', employee_code: doc });
        if (msg === 'EMPLOYEE_TERMINATED') return reply.status(403).send({ error: 'EMPLOYEE_TERMINATED' });
        if (msg === 'NASAJON_UNAVAILABLE') return reply.status(503).send({ error: 'NASAJON_UNAVAILABLE' });
        throw err;
      }
    }

    const enrollmentStatus = await lyceumClient.getStudentEnrollmentStatus(doc);
    if (enrollmentStatus !== null && enrollmentStatus !== 'Matriculado') {
      const primaryId = primary_student_id ? parseInt(primary_student_id) : null;
      await logInvalidDocument(doc, enrollmentStatus, context === 'loan' ? 'loan' : 'primary', 'rfid', operator.sub, primaryId);
      return reply.status(403).send({ error: 'STUDENT_NOT_ENROLLED', situation_detail: enrollmentStatus });
    }

    try {
      return await findOrCreateStudent(doc, { strict: false, force: force === 'true' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'STUDENT_NOT_IN_LYCEUM') return reply.status(422).send({ error: 'STUDENT_NOT_IN_LYCEUM', registration_number: doc });
      if (msg === 'STUDENT_NOT_FOUND') return reply.status(404).send({ error: 'STUDENT_NOT_FOUND' });
      throw err;
    }
  });

  // Identify by facial recognition — routes to employee service when matricula is not student format
  app.post('/students/identify/facial', { preHandler: requireAuth(['operator', 'admin']) }, async (req, reply) => {
    const { image } = req.body as { image: string };
    const { force, context = 'primary', primary_student_id } = req.query as { force?: string; context?: string; primary_student_id?: string };
    if (!image) return reply.status(400).send({ error: 'MISSING_IMAGE' });
    const operator = req.user as JwtPayload;

    let recognition;
    try {
      recognition = await vectorAIClient.recognizeFace(image);
    } catch {
      return reply.status(503).send({ error: 'VECTOR_AI_UNAVAILABLE' });
    }

    if (!recognition) return reply.status(422).send({ error: 'FACE_NOT_RECOGNIZED' });

    if (!recognition.matricula) {
      return reply.status(422).send({ error: 'FACE_NOT_RECOGNIZED', box: recognition.box });
    }

    const doc = recognition.matricula;

    // Route to employee service when document is not student format
    if (detectUserType(doc) === 'employee') {
      try {
        const result = await findOrCreateEmployee(doc, { strict: false, force: force === 'true' });
        return { ...result, confidence: recognition.confidence, box: recognition.box };
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg === 'EMPLOYEE_NOT_IN_NASAJON') return reply.status(422).send({ error: 'EMPLOYEE_NOT_IN_NASAJON', employee_code: doc, box: recognition.box });
        if (msg === 'EMPLOYEE_TERMINATED') return reply.status(403).send({ error: 'EMPLOYEE_TERMINATED' });
        if (msg === 'NASAJON_UNAVAILABLE') return reply.status(503).send({ error: 'NASAJON_UNAVAILABLE' });
        throw err;
      }
    }

    const enrollmentStatus = await lyceumClient.getStudentEnrollmentStatus(doc);
    if (enrollmentStatus !== null && enrollmentStatus !== 'Matriculado') {
      const primaryId = primary_student_id ? parseInt(primary_student_id) : null;
      await logInvalidDocument(doc, enrollmentStatus, context === 'loan' ? 'loan' : 'primary', 'facial', operator.sub, primaryId);
      return reply.status(403).send({ error: 'STUDENT_NOT_ENROLLED', situation_detail: enrollmentStatus, box: recognition.box });
    }

    try {
      const result = await findOrCreateStudent(doc, { strict: false, force: force === 'true' });
      return { ...result, confidence: recognition.confidence, box: recognition.box };
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'STUDENT_NOT_IN_LYCEUM') return reply.status(422).send({ error: 'STUDENT_NOT_IN_LYCEUM', registration_number: doc, box: recognition.box });
      if (msg === 'STUDENT_NOT_FOUND') return reply.status(404).send({ error: 'STUDENT_NOT_FOUND' });
      throw err;
    }
  });

  // Today's activity — returns BOTH students and employees who printed today
  app.get('/students/today', { preHandler: requireAuth(['operator', 'auditor', 'admin']) }, async () => {
    // Student debit rows
    const studentDebitRows = await db('entries')
      .join('print_operations', 'entries.print_operation_id', 'print_operations.id')
      .join('students', function () {
        this.on('entries.user_type', db.raw("'student'")).andOn('entries.user_id', 'students.id');
      })
      .whereRaw(TODAY_EXPR)
      .where('entries.user_type', 'student')
      .groupBy('students.id', 'students.name', 'students.registration_number', 'students.course', 'students.period')
      .select(
        'students.id',
        'students.name',
        'students.registration_number as identifier',
        db.raw("CONCAT_WS(' · ', NULLIF(students.course, ''), NULLIF(students.period, '')) as detail"),
        db.raw("'student' as user_type"),
        db.raw('SUM(entries.sheets) as quota_used'),
        db.raw("SUM(CASE WHEN entries.type = 'borrowed' THEN entries.sheets ELSE 0 END) as sheets_lent"),
        db.raw('MAX(print_operations.created_at) as last_operation_at')
      ) as Array<{
        id: number; name: string; identifier: string; detail: string; user_type: string;
        quota_used: string; sheets_lent: string; last_operation_at: string;
      }>;

    // Employee debit rows
    const employeeDebitRows = await db('entries')
      .join('print_operations', 'entries.print_operation_id', 'print_operations.id')
      .join('employees', function () {
        this.on('entries.user_type', db.raw("'employee'")).andOn('entries.user_id', 'employees.id');
      })
      .whereRaw(TODAY_EXPR)
      .where('entries.user_type', 'employee')
      .groupBy('employees.id', 'employees.name', 'employees.employee_code', 'employees.department')
      .select(
        'employees.id',
        'employees.name',
        'employees.employee_code as identifier',
        'employees.department as detail',
        db.raw("'employee' as user_type"),
        db.raw('SUM(entries.sheets) as quota_used'),
        db.raw("SUM(CASE WHEN entries.type = 'borrowed' THEN entries.sheets ELSE 0 END) as sheets_lent"),
        db.raw('MAX(print_operations.created_at) as last_operation_at')
      ) as Array<{
        id: number; name: string; identifier: string; detail: string; user_type: string;
        quota_used: string; sheets_lent: string; last_operation_at: string;
      }>;

    // Primary operations for total_printed — students
    const studentPrimaryRows = await db('print_operations')
      .where('print_operations.user_type', 'student')
      .whereRaw(TODAY_EXPR)
      .groupBy('print_operations.user_id')
      .select('print_operations.user_id as id', db.raw('SUM(print_operations.total_sheets) as total_printed')) as Array<{
        id: number; total_printed: string;
      }>;

    // Primary operations for total_printed — employees
    const employeePrimaryRows = await db('print_operations')
      .where('print_operations.user_type', 'employee')
      .whereRaw(TODAY_EXPR)
      .groupBy('print_operations.user_id')
      .select('print_operations.user_id as id', db.raw('SUM(print_operations.total_sheets) as total_printed')) as Array<{
        id: number; total_printed: string;
      }>;

    // Operations that had borrowed entries — who received loans (student primaries)
    const studentReceivedLoanOps = await db('entries')
      .join('print_operations', 'entries.print_operation_id', 'print_operations.id')
      .whereRaw(TODAY_EXPR)
      .where('entries.type', 'borrowed')
      .where('print_operations.user_type', 'student')
      .distinct('print_operations.user_id') as Array<{ user_id: number }>;

    // Operations that had borrowed entries — who received loans (employee primaries)
    const employeeReceivedLoanOps = await db('entries')
      .join('print_operations', 'entries.print_operation_id', 'print_operations.id')
      .whereRaw(TODAY_EXPR)
      .where('entries.type', 'borrowed')
      .where('print_operations.user_type', 'employee')
      .distinct('print_operations.user_id') as Array<{ user_id: number }>;

    // Most recent identify_method per user today
    const allMethodRows = await db('print_operations')
      .whereRaw(`DATE(print_operations.created_at AT TIME ZONE 'America/Sao_Paulo') = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date`)
      .orderBy('print_operations.created_at', 'desc')
      .select('user_id', 'user_type', 'identify_method') as Array<{
        user_id: number; user_type: string; identify_method: string;
      }>;

    const studentMethodMap = new Map<number, string>();
    const employeeMethodMap = new Map<number, string>();
    for (const row of allMethodRows) {
      if (row.user_type === 'student' && !studentMethodMap.has(row.user_id)) {
        studentMethodMap.set(row.user_id, row.identify_method);
      } else if (row.user_type === 'employee' && !employeeMethodMap.has(row.user_id)) {
        employeeMethodMap.set(row.user_id, row.identify_method);
      }
    }

    const studentReceivedLoanIds = new Set(studentReceivedLoanOps.map((r) => r.user_id));
    const employeeReceivedLoanIds = new Set(employeeReceivedLoanOps.map((r) => r.user_id));
    const studentPrimaryMap = new Map(studentPrimaryRows.map((r) => [r.id, parseInt(r.total_printed)]));
    const employeePrimaryMap = new Map(employeePrimaryRows.map((r) => [r.id, parseInt(r.total_printed)]));

    const studentResults = studentDebitRows.map((r) => ({
      id: r.id,
      user_type: 'student',
      identifier: r.identifier,
      name: r.name,
      detail: r.detail,
      quota_used: parseInt(r.quota_used),
      sheets_lent: parseInt(r.sheets_lent) || 0,
      total_printed: studentPrimaryMap.get(r.id) ?? 0,
      gave_loans: (parseInt(r.sheets_lent) || 0) > 0,
      received_loans: studentReceivedLoanIds.has(r.id),
      last_operation_at: r.last_operation_at,
      identify_method: studentMethodMap.get(r.id) ?? null,
    }));

    const employeeResults = employeeDebitRows.map((r) => ({
      id: r.id,
      user_type: 'employee',
      identifier: r.identifier,
      name: r.name,
      detail: r.detail,
      quota_used: parseInt(r.quota_used),
      sheets_lent: parseInt(r.sheets_lent) || 0,
      total_printed: employeePrimaryMap.get(r.id) ?? 0,
      gave_loans: (parseInt(r.sheets_lent) || 0) > 0,
      received_loans: employeeReceivedLoanIds.has(r.id),
      last_operation_at: r.last_operation_at,
      identify_method: employeeMethodMap.get(r.id) ?? null,
    }));

    const combined = [...studentResults, ...employeeResults];
    combined.sort((a, b) => new Date(b.last_operation_at).getTime() - new Date(a.last_operation_at).getTime());
    return combined;
  });

  // Full history for a student
  app.get('/students/:id/full-history', { preHandler: requireAuth(['operator', 'auditor', 'admin']) }, async (req) => {
    const studentId = parseInt((req.params as { id: string }).id);
    const { date } = req.query as { date?: string };

    const dateFilter = (col: string) =>
      date
        ? `DATE(${col} AT TIME ZONE 'America/Sao_Paulo') = '${date}'`
        : `DATE(${col} AT TIME ZONE 'America/Sao_Paulo') <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date`;

    // Operations where this student was primary
    const operations = await db('print_operations')
      .join('system_users', 'print_operations.operator_id', 'system_users.id')
      .where('print_operations.user_type', 'student')
      .where('print_operations.user_id', studentId)
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
          .leftJoin('students', function () {
            this.on('entries.user_type', db.raw("'student'")).andOn('entries.user_id', 'students.id');
          })
          .leftJoin('employees', function () {
            this.on('entries.user_type', db.raw("'employee'")).andOn('entries.user_id', 'employees.id');
          })
          .whereIn('entries.print_operation_id', opIds)
          .select(
            'entries.*',
            db.raw("COALESCE(students.name, employees.name) as user_name"),
            db.raw("COALESCE(students.registration_number, employees.employee_code) as user_identifier"),
            db.raw("COALESCE(students.course, employees.department, '') as user_detail"),
          )
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
      own_sheets: (entriesByOp.get(op.id) ?? [])
        .filter((e) => e.user_type === 'student' && e.user_id === studentId)
        .reduce((s: number, e: { sheets: number }) => s + e.sheets, 0),
      borrowed_sheets: (entriesByOp.get(op.id) ?? [])
        .filter((e) => !(e.user_type === 'student' && e.user_id === studentId))
        .reduce((s: number, e: { sheets: number }) => s + e.sheets, 0),
    }));

    // Entries where this student's quota was used in someone else's operation
    const loanEntries = await db('entries')
      .join('print_operations', 'entries.print_operation_id', 'print_operations.id')
      .leftJoin('students as primary_s', function () {
        this.on('print_operations.user_type', db.raw("'student'")).andOn('print_operations.user_id', 'primary_s.id');
      })
      .leftJoin('employees as primary_e', function () {
        this.on('print_operations.user_type', db.raw("'employee'")).andOn('print_operations.user_id', 'primary_e.id');
      })
      .join('system_users', 'print_operations.operator_id', 'system_users.id')
      .where('entries.user_type', 'student')
      .where('entries.user_id', studentId)
      .where('entries.type', 'borrowed')
      .whereRaw(dateFilter('print_operations.created_at'))
      .select(
        'entries.id',
        'entries.sheets',
        'entries.created_at',
        'print_operations.id as operation_id',
        'print_operations.total_sheets as operation_total',
        'print_operations.user_type as primary_user_type',
        db.raw("COALESCE(primary_s.id, primary_e.id) as primary_user_id"),
        db.raw("COALESCE(primary_s.name, primary_e.name) as primary_user_name"),
        db.raw("COALESCE(primary_s.registration_number, primary_e.employee_code) as primary_identifier"),
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

  // Simple entry history (used by reports) — filter by user_type+user_id
  app.get('/students/:id/history', { preHandler: requireAuth(['operator', 'auditor', 'admin']) }, async (req) => {
    const { id } = req.params as { id: string };
    const { date } = req.query as { date?: string };

    const query = db('entries')
      .join('print_operations', 'entries.print_operation_id', 'print_operations.id')
      .join('system_users', 'print_operations.operator_id', 'system_users.id')
      .where('print_operations.user_type', 'student')
      .where('print_operations.user_id', parseInt(id))
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
