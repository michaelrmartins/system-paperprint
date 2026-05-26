import { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import { findOrCreateEmployee } from '../services/employeeService.js';
import * as situatorClient from '../clients/situatorClient.js';
import * as nasajonClient from '../clients/nasajonClient.js';
import { detectUserType } from '../lib/documentUtils.js';
import { db } from '../db/knex.js';
import { JwtPayload } from '../types/index.js';

const TODAY_EXPR = `DATE(print_operations.created_at AT TIME ZONE 'America/Sao_Paulo') = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date`;

async function logInvalidDocument(
  document: string,
  situationDetail: string,
  context: 'primary' | 'loan',
  identifyMethod: 'manual' | 'rfid' | 'facial',
  operatorId: number,
  primaryUserType?: 'student' | 'employee' | null,
  primaryUserId?: number | null,
) {
  await db('invalid_document_attempts').insert({
    document,
    situation_detail: situationDetail,
    context,
    identify_method: identifyMethod,
    operator_id: operatorId,
    primary_user_type: primaryUserType ?? null,
    primary_user_id: primaryUserId ?? null,
    // Keep primary_student_id null for employee contexts (no valid student FK)
    primary_student_id: null,
  });
}

export async function employeeRoutes(app: FastifyInstance) {
  // Identify by manual employee code
  app.post('/employees/identify/manual', { preHandler: requireAuth(['operator', 'admin']) }, async (req, reply) => {
    const { employee_code } = req.body as { employee_code: string };
    const { force, context = 'primary', primary_user_id, primary_user_type } = req.query as {
      force?: string;
      context?: string;
      primary_user_id?: string;
      primary_user_type?: string;
    };

    if (!employee_code?.trim()) {
      return reply.status(400).send({ error: 'MISSING_EMPLOYEE_CODE' });
    }

    const code = employee_code.trim();
    const operator = req.user as JwtPayload;

    // If the document looks like a student number, redirect to the student flow
    if (detectUserType(code) === 'student') {
      return reply.status(422).send({ error: 'USE_STUDENT_IDENTIFY', registration_number: code });
    }

    try {
      return await findOrCreateEmployee(code, { strict: false, force: force === 'true' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'EMPLOYEE_NOT_IN_NASAJON') {
        return reply.status(422).send({ error: 'EMPLOYEE_NOT_IN_NASAJON', employee_code: code });
      }
      if (msg === 'EMPLOYEE_TERMINATED') {
        const primaryId = primary_user_id ? parseInt(primary_user_id) : null;
        const primaryType = (primary_user_type as 'student' | 'employee') || null;
        await logInvalidDocument(code, 'TERMINATED', context === 'loan' ? 'loan' : 'primary', 'manual', operator.sub, primaryType, primaryId);
        return reply.status(403).send({ error: 'EMPLOYEE_TERMINATED' });
      }
      if (msg === 'NASAJON_UNAVAILABLE') {
        return reply.status(503).send({ error: 'NASAJON_UNAVAILABLE' });
      }
      throw err;
    }
  });

  // Identify by RFID card hex — routes to employee when Situator Document is not student format
  app.post('/employees/identify/rfid', { preHandler: requireAuth(['operator', 'admin']) }, async (req, reply) => {
    const { card_hex } = req.body as { card_hex: string };
    const { force, context = 'primary', primary_user_id, primary_user_type } = req.query as {
      force?: string;
      context?: string;
      primary_user_id?: string;
      primary_user_type?: string;
    };

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

    if (!person.Active) return reply.status(403).send({ error: 'EMPLOYEE_INACTIVE' });
    if (!person.Document) return reply.status(422).send({ error: 'DOCUMENT_NOT_FOUND' });

    const doc = person.Document;

    // If it resolves to a student format, let the caller know to use the student endpoint
    if (detectUserType(doc) === 'student') {
      return reply.status(422).send({ error: 'USE_STUDENT_IDENTIFY', registration_number: doc });
    }

    try {
      return await findOrCreateEmployee(doc, { strict: false, force: force === 'true' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'EMPLOYEE_NOT_IN_NASAJON') {
        return reply.status(422).send({ error: 'EMPLOYEE_NOT_IN_NASAJON', employee_code: doc });
      }
      if (msg === 'EMPLOYEE_TERMINATED') {
        const primaryId = primary_user_id ? parseInt(primary_user_id) : null;
        const primaryType = (primary_user_type as 'student' | 'employee') || null;
        await logInvalidDocument(doc, 'TERMINATED', context === 'loan' ? 'loan' : 'primary', 'rfid', operator.sub, primaryType, primaryId);
        return reply.status(403).send({ error: 'EMPLOYEE_TERMINATED' });
      }
      if (msg === 'NASAJON_UNAVAILABLE') {
        return reply.status(503).send({ error: 'NASAJON_UNAVAILABLE' });
      }
      throw err;
    }
  });

  // Today's employees who printed — mirroring /students/today structure
  app.get('/employees/today', { preHandler: requireAuth(['operator', 'auditor', 'admin']) }, async () => {
    const debitRows = await db('entries')
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
        'employees.employee_code',
        'employees.department',
        db.raw('SUM(entries.sheets) as quota_used'),
        db.raw("SUM(CASE WHEN entries.type = 'borrowed' THEN entries.sheets ELSE 0 END) as sheets_lent"),
        db.raw('MAX(print_operations.created_at) as last_operation_at')
      )
      .orderBy('last_operation_at', 'desc') as Array<{
        id: number; name: string; employee_code: string; department: string;
        quota_used: string; sheets_lent: string; last_operation_at: string;
      }>;

    const primaryRows = await db('print_operations')
      .join('employees', function () {
        this.on('print_operations.user_type', db.raw("'employee'")).andOn('print_operations.user_id', 'employees.id');
      })
      .where('print_operations.user_type', 'employee')
      .whereRaw(TODAY_EXPR)
      .groupBy('employees.id')
      .select('employees.id', db.raw('SUM(print_operations.total_sheets) as total_printed')) as Array<{
        id: number; total_printed: string;
      }>;

    const receivedLoanOps = await db('entries')
      .join('print_operations', 'entries.print_operation_id', 'print_operations.id')
      .whereRaw(TODAY_EXPR)
      .where('entries.type', 'borrowed')
      .where('print_operations.user_type', 'employee')
      .distinct('print_operations.user_id') as Array<{ user_id: number }>;

    const methodRows = await db('print_operations')
      .where('print_operations.user_type', 'employee')
      .whereRaw(`DATE(print_operations.created_at AT TIME ZONE 'America/Sao_Paulo') = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date`)
      .orderBy('print_operations.created_at', 'desc')
      .select('print_operations.user_id', 'print_operations.identify_method') as Array<{
        user_id: number; identify_method: string;
      }>;

    const methodMap = new Map<number, string>();
    for (const row of methodRows) {
      if (!methodMap.has(row.user_id)) methodMap.set(row.user_id, row.identify_method);
    }

    const receivedLoanIds = new Set(receivedLoanOps.map((r) => r.user_id));
    const primaryMap = new Map(primaryRows.map((r) => [r.id, parseInt(r.total_printed)]));

    return debitRows.map((r) => ({
      id: r.id,
      employee_code: r.employee_code,
      name: r.name,
      department: r.department,
      user_type: 'employee',
      quota_used: parseInt(r.quota_used),
      sheets_lent: parseInt(r.sheets_lent) || 0,
      total_printed: primaryMap.get(r.id) ?? 0,
      gave_loans: (parseInt(r.sheets_lent) || 0) > 0,
      received_loans: receivedLoanIds.has(r.id),
      last_operation_at: r.last_operation_at,
      identify_method: methodMap.get(r.id) ?? null,
    }));
  });

  // Full history for a specific employee
  app.get('/employees/:id/full-history', { preHandler: requireAuth(['operator', 'auditor', 'admin']) }, async (req) => {
    const employeeId = parseInt((req.params as { id: string }).id);
    const { date } = req.query as { date?: string };

    const dateFilter = (col: string) =>
      date
        ? `DATE(${col} AT TIME ZONE 'America/Sao_Paulo') = '${date}'`
        : `DATE(${col} AT TIME ZONE 'America/Sao_Paulo') <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date`;

    // Operations where this employee was primary
    const operations = await db('print_operations')
      .join('system_users', 'print_operations.operator_id', 'system_users.id')
      .where('print_operations.user_type', 'employee')
      .where('print_operations.user_id', employeeId)
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
        .filter((e) => e.user_type === 'employee' && e.user_id === employeeId)
        .reduce((s: number, e: { sheets: number }) => s + e.sheets, 0),
      borrowed_sheets: (entriesByOp.get(op.id) ?? [])
        .filter((e) => !(e.user_type === 'employee' && e.user_id === employeeId))
        .reduce((s: number, e: { sheets: number }) => s + e.sheets, 0),
    }));

    // Entries where this employee's quota was used in someone else's operation
    const loanEntries = await db('entries')
      .join('print_operations', 'entries.print_operation_id', 'print_operations.id')
      .leftJoin('students as primary_s', function () {
        this.on('print_operations.user_type', db.raw("'student'")).andOn('print_operations.user_id', 'primary_s.id');
      })
      .leftJoin('employees as primary_e', function () {
        this.on('print_operations.user_type', db.raw("'employee'")).andOn('print_operations.user_id', 'primary_e.id');
      })
      .join('system_users', 'print_operations.operator_id', 'system_users.id')
      .where('entries.user_type', 'employee')
      .where('entries.user_id', employeeId)
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

  // Fetch photo for an employee from Nasajon
  app.get('/employees/:id/photo', { preHandler: requireAuth(['operator', 'auditor', 'admin']) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const employee = await db('employees').where('id', parseInt(id)).first();
    if (!employee) return reply.status(404).send({ error: 'NOT_FOUND' });

    try {
      const data = await nasajonClient.getEmployeeByCode(employee.employee_code);
      return { photo: data.photo };
    } catch {
      return { photo: null };
    }
  });
}
