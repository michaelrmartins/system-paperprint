import { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db/knex.js';

export async function reportRoutes(app: FastifyInstance) {
  // Consumption by course — student-specific
  app.get('/reports/by-course', { preHandler: requireAuth(['operator', 'auditor', 'admin']) }, async (req) => {
    const { start, end } = req.query as { start?: string; end?: string };
    return db('entries')
      .join('students', function () {
        this.on('entries.user_type', db.raw("'student'")).andOn('entries.user_id', 'students.id');
      })
      .join('print_operations', 'entries.print_operation_id', 'print_operations.id')
      .where('entries.user_type', 'student')
      .modify((q) => {
        if (start) q.where('print_operations.created_at', '>=', start);
        if (end) q.where('print_operations.created_at', '<=', end);
      })
      .groupBy('students.course')
      .select('students.course', db.raw('SUM(entries.sheets) as total_sheets'))
      .orderBy('total_sheets', 'desc');
  });

  // Consumption by period — student-specific
  app.get('/reports/by-period', { preHandler: requireAuth(['operator', 'auditor', 'admin']) }, async (req) => {
    const { start, end } = req.query as { start?: string; end?: string };
    return db('print_operations')
      .join('students', function () {
        this.on('print_operations.user_type', db.raw("'student'")).andOn('print_operations.user_id', 'students.id');
      })
      .join('entries', 'entries.print_operation_id', 'print_operations.id')
      .where('print_operations.user_type', 'student')
      .modify((q) => {
        if (start) q.where('print_operations.created_at', '>=', start);
        if (end) q.where('print_operations.created_at', '<=', end);
      })
      .groupBy('students.course', 'students.period')
      .select('students.course', 'students.period', db.raw('SUM(entries.sheets) as total_sheets'))
      .orderBy('total_sheets', 'desc');
  });

  // Top users by consumption — groups by primary requestor, not quota debited
  app.get('/reports/top-students', { preHandler: requireAuth(['operator', 'auditor', 'admin']) }, async (req) => {
    const { start, end, limit = '20' } = req.query as { start?: string; end?: string; limit?: string };
    return db('print_operations')
      .leftJoin('students', function () {
        this.on('print_operations.user_type', db.raw("'student'")).andOn('print_operations.user_id', 'students.id');
      })
      .leftJoin('employees', function () {
        this.on('print_operations.user_type', db.raw("'employee'")).andOn('print_operations.user_id', 'employees.id');
      })
      .modify((q) => {
        if (start) q.where('print_operations.created_at', '>=', start);
        if (end) q.where('print_operations.created_at', '<=', `${end}T23:59:59`);
      })
      .groupBy(
        'print_operations.user_type', 'print_operations.user_id',
        'students.id', 'students.name', 'students.registration_number', 'students.course', 'students.period',
        'employees.id', 'employees.name', 'employees.employee_code', 'employees.department',
      )
      .select(
        'print_operations.user_type',
        db.raw("COALESCE(students.id, employees.id) as id"),
        db.raw("COALESCE(students.name, employees.name) as name"),
        db.raw("COALESCE(students.registration_number, employees.employee_code) as identifier"),
        db.raw("COALESCE(students.course, employees.department, '') as detail"),
        db.raw('SUM(print_operations.total_sheets) as total_sheets'),
      )
      .orderBy('total_sheets', 'desc')
      .limit(parseInt(limit));
  });

  // Monthly evolution
  app.get('/reports/monthly', { preHandler: requireAuth(['operator', 'auditor', 'admin']) }, async (req) => {
    const { year = String(new Date().getFullYear()) } = req.query as { year?: string };
    return db('entries')
      .join('print_operations', 'entries.print_operation_id', 'print_operations.id')
      .whereRaw(`EXTRACT(YEAR FROM print_operations.created_at AT TIME ZONE 'America/Sao_Paulo') = ?`, [year])
      .groupByRaw(`EXTRACT(MONTH FROM print_operations.created_at AT TIME ZONE 'America/Sao_Paulo')`)
      .select(
        db.raw(`EXTRACT(MONTH FROM print_operations.created_at AT TIME ZONE 'America/Sao_Paulo') as month`),
        db.raw('SUM(entries.sheets) as total_sheets'),
        db.raw('COUNT(DISTINCT entries.print_operation_id) as total_operations')
      )
      .orderBy('month');
  });

  // Audit log — dual JOIN for entry user
  app.get('/reports/audit', { preHandler: requireAuth(['operator', 'auditor', 'admin']) }, async (req) => {
    const { start, end } = req.query as { start?: string; end?: string };
    return db('audit_log')
      .join('system_users', 'audit_log.operator_id', 'system_users.id')
      .join('entries', 'audit_log.entry_id', 'entries.id')
      .leftJoin('students', function () {
        this.on('entries.user_type', db.raw("'student'")).andOn('entries.user_id', 'students.id');
      })
      .leftJoin('employees', function () {
        this.on('entries.user_type', db.raw("'employee'")).andOn('entries.user_id', 'employees.id');
      })
      .modify((q) => {
        if (start) q.where('audit_log.created_at', '>=', start);
        if (end) q.where('audit_log.created_at', '<=', end);
      })
      .select(
        'audit_log.id',
        'audit_log.entry_id',
        'audit_log.operator_id',
        'audit_log.previous_value',
        'audit_log.new_value',
        'audit_log.reason',
        db.raw(`to_char(audit_log.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS') as created_at`),
        'system_users.login as operator_login',
        'entries.user_type',
        db.raw("COALESCE(students.name, employees.name) as user_name"),
        db.raw("COALESCE(students.registration_number, employees.employee_code) as user_identifier"),
      )
      .orderBy('audit_log.created_at', 'desc');
  });

  // Top employees by sheets printed
  app.get('/reports/top-employees', { preHandler: requireAuth(['operator', 'auditor', 'admin']) }, async (req) => {
    const { start, end, limit = '20' } = req.query as { start?: string; end?: string; limit?: string };
    return db('entries')
      .join('print_operations', 'entries.print_operation_id', 'print_operations.id')
      .join('employees', function () {
        this.on('entries.user_type', db.raw("'employee'")).andOn('entries.user_id', 'employees.id');
      })
      .where('entries.user_type', 'employee')
      .modify((q) => {
        if (start) q.where('print_operations.created_at', '>=', start);
        if (end) q.where('print_operations.created_at', '<=', end);
      })
      .groupBy('employees.id', 'employees.name', 'employees.employee_code', 'employees.department')
      .select(
        'employees.id',
        'employees.name',
        'employees.employee_code',
        'employees.department',
        db.raw('SUM(entries.sheets) as total_sheets'),
      )
      .orderBy('total_sheets', 'desc')
      .limit(parseInt(limit));
  });

  // Peak hours — operations and sheets by hour of day
  app.get('/reports/by-hour', { preHandler: requireAuth(['operator', 'auditor', 'admin']) }, async (req) => {
    const { start, end } = req.query as { start?: string; end?: string };
    const rows = await db('print_operations')
      .modify((q) => {
        if (start) q.where('created_at', '>=', start);
        if (end) q.where('created_at', '<=', `${end}T23:59:59`);
      })
      .groupByRaw(`EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Sao_Paulo')`)
      .select(
        db.raw(`EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Sao_Paulo') as hour`),
        db.raw('COUNT(*) as total_operations'),
        db.raw('SUM(total_sheets) as total_sheets'),
      )
      .orderBy('hour');
    // Fill missing hours with zero
    const map = new Map((rows as Array<{ hour: number; total_operations: string; total_sheets: string }>).map(r => [Number(r.hour), r]));
    return Array.from({ length: 24 }, (_, h) => {
      const row = map.get(h);
      return { hour: h, total_operations: Number(row?.total_operations ?? 0), total_sheets: Number(row?.total_sheets ?? 0) };
    });
  });

  // Operations per operator
  app.get('/reports/by-operator', { preHandler: requireAuth(['operator', 'auditor', 'admin']) }, async (req) => {
    const { start, end } = req.query as { start?: string; end?: string };
    return db('print_operations')
      .join('system_users', 'print_operations.operator_id', 'system_users.id')
      .modify((q) => {
        if (start) q.where('print_operations.created_at', '>=', start);
        if (end) q.where('print_operations.created_at', '<=', `${end}T23:59:59`);
      })
      .groupBy('system_users.id', 'system_users.login')
      .select(
        'system_users.login as operator',
        db.raw('COUNT(DISTINCT print_operations.id) as total_operations'),
        db.raw('SUM(print_operations.total_sheets) as total_sheets'),
      )
      .orderBy('total_operations', 'desc');
  });

  // Own prints vs borrowed quota
  app.get('/reports/own-vs-borrowed', { preHandler: requireAuth(['operator', 'auditor', 'admin']) }, async (req) => {
    const { start, end } = req.query as { start?: string; end?: string };
    return db('entries')
      .join('print_operations', 'entries.print_operation_id', 'print_operations.id')
      .modify((q) => {
        if (start) q.where('print_operations.created_at', '>=', start);
        if (end) q.where('print_operations.created_at', '<=', `${end}T23:59:59`);
      })
      .groupBy('entries.type')
      .select(
        'entries.type',
        db.raw('SUM(entries.sheets) as total_sheets'),
        db.raw('COUNT(DISTINCT entries.print_operation_id) as total_operations'),
      );
  });

  // Identification method breakdown
  app.get('/reports/by-identify-method', { preHandler: requireAuth(['operator', 'auditor', 'admin']) }, async (req) => {
    const { start, end } = req.query as { start?: string; end?: string };
    return db('print_operations')
      .modify((q) => {
        if (start) q.where('created_at', '>=', start);
        if (end) q.where('created_at', '<=', `${end}T23:59:59`);
      })
      .groupBy('identify_method')
      .select(
        'identify_method',
        db.raw('COUNT(*) as total_operations'),
        db.raw('SUM(total_sheets) as total_sheets'),
      )
      .orderBy('total_operations', 'desc');
  });

  // Daily evolution
  app.get('/reports/daily', { preHandler: requireAuth(['operator', 'auditor', 'admin']) }, async (req) => {
    const { start, end } = req.query as { start?: string; end?: string };
    return db('entries')
      .join('print_operations', 'entries.print_operation_id', 'print_operations.id')
      .modify((q) => {
        if (start) q.where('print_operations.created_at', '>=', start);
        if (end) q.where('print_operations.created_at', '<=', `${end}T23:59:59`);
      })
      .groupByRaw(`DATE(print_operations.created_at AT TIME ZONE 'America/Sao_Paulo')`)
      .select(
        db.raw(`DATE(print_operations.created_at AT TIME ZONE 'America/Sao_Paulo')::text as day`),
        db.raw('SUM(entries.sheets) as total_sheets'),
        db.raw('COUNT(DISTINCT entries.print_operation_id) as total_operations'),
      )
      .orderBy('day');
  });

  // Students within a period+course combo (for expandable rows) — student-specific
  app.get('/reports/period-students', { preHandler: requireAuth(['operator', 'auditor', 'admin']) }, async (req) => {
    const { period, course, start, end } = req.query as { period?: string; course?: string; start?: string; end?: string };
    if (!period) return [];
    return db('print_operations')
      .join('students', function () {
        this.on('print_operations.user_type', db.raw("'student'")).andOn('print_operations.user_id', 'students.id');
      })
      .join('entries', 'entries.print_operation_id', 'print_operations.id')
      .where('print_operations.user_type', 'student')
      .where('students.period', period)
      .modify((q) => {
        if (course) q.where('students.course', course);
        if (start) q.where('print_operations.created_at', '>=', start);
        if (end) q.where('print_operations.created_at', '<=', `${end}T23:59:59`);
      })
      .groupBy('students.id', 'students.name', 'students.registration_number')
      .select(
        'students.id',
        'students.name',
        'students.registration_number',
        db.raw('SUM(entries.sheets) as total_sheets'),
      )
      .orderBy('total_sheets', 'desc');
  });

  // Blocked enrollment status attempts — for audit/compliance reports
  app.get('/reports/invalid-documents', { preHandler: requireAuth(['operator', 'auditor', 'admin']) }, async (req) => {
    const { start, end } = req.query as { start?: string; end?: string };
    return db('invalid_document_attempts')
      .join('system_users', 'invalid_document_attempts.operator_id', 'system_users.id')
      .leftJoin('students as primary_s', 'invalid_document_attempts.primary_student_id', 'primary_s.id')
      .modify((q) => {
        if (start) q.where('invalid_document_attempts.created_at', '>=', start);
        if (end) q.where('invalid_document_attempts.created_at', '<=', `${end}T23:59:59`);
      })
      .select(
        'invalid_document_attempts.id',
        'invalid_document_attempts.document',
        'invalid_document_attempts.situation_detail',
        'invalid_document_attempts.context',
        'invalid_document_attempts.identify_method',
        'invalid_document_attempts.primary_user_type',
        db.raw(`to_char(invalid_document_attempts.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS') as created_at`),
        'system_users.login as operator_login',
        'primary_s.name as primary_student_name',
        'primary_s.registration_number as primary_student_registration',
      )
      .orderBy('invalid_document_attempts.created_at', 'desc');
  });
}
