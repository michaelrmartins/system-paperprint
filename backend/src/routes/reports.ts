import { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db/knex.js';

export async function reportRoutes(app: FastifyInstance) {
  // Consumption by course
  app.get('/reports/by-course', { preHandler: requireAuth(['operator', 'auditor', 'admin']) }, async (req) => {
    const { start, end } = req.query as { start?: string; end?: string };
    return db('entries')
      .join('students', 'entries.student_id', 'students.id')
      .join('print_operations', 'entries.print_operation_id', 'print_operations.id')
      .modify((q) => {
        if (start) q.where('print_operations.created_at', '>=', start);
        if (end) q.where('print_operations.created_at', '<=', end);
      })
      .groupBy('students.course')
      .select('students.course', db.raw('SUM(entries.sheets) as total_sheets'))
      .orderBy('total_sheets', 'desc');
  });

  // Consumption by period
  app.get('/reports/by-period', { preHandler: requireAuth(['operator', 'auditor', 'admin']) }, async (req) => {
    const { start, end } = req.query as { start?: string; end?: string };
    return db('entries')
      .join('students', 'entries.student_id', 'students.id')
      .join('print_operations', 'entries.print_operation_id', 'print_operations.id')
      .modify((q) => {
        if (start) q.where('print_operations.created_at', '>=', start);
        if (end) q.where('print_operations.created_at', '<=', end);
      })
      .groupBy('students.period')
      .select('students.period', db.raw('SUM(entries.sheets) as total_sheets'))
      .orderBy('total_sheets', 'desc');
  });

  // Top N students by consumption
  app.get('/reports/top-students', { preHandler: requireAuth(['operator', 'auditor', 'admin']) }, async (req) => {
    const { start, end, limit = '20' } = req.query as { start?: string; end?: string; limit?: string };
    return db('entries')
      .join('students', 'entries.student_id', 'students.id')
      .join('print_operations', 'entries.print_operation_id', 'print_operations.id')
      .modify((q) => {
        if (start) q.where('print_operations.created_at', '>=', start);
        if (end) q.where('print_operations.created_at', '<=', end);
      })
      .groupBy('students.id', 'students.name', 'students.registration_number', 'students.course', 'students.period')
      .select(
        'students.id',
        'students.name',
        'students.registration_number',
        'students.course',
        'students.period',
        db.raw('SUM(entries.sheets) as total_sheets')
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

  // Audit log
  app.get('/reports/audit', { preHandler: requireAuth(['operator', 'auditor', 'admin']) }, async (req) => {
    const { start, end } = req.query as { start?: string; end?: string };
    return db('audit_log')
      .join('system_users', 'audit_log.operator_id', 'system_users.id')
      .join('entries', 'audit_log.entry_id', 'entries.id')
      .join('students', 'entries.student_id', 'students.id')
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
        'students.name as student_name',
        'students.registration_number'
      )
      .orderBy('audit_log.created_at', 'desc');
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

  // Students within a period (for expandable rows)
  app.get('/reports/period-students', { preHandler: requireAuth(['operator', 'auditor', 'admin']) }, async (req) => {
    const { period, start, end } = req.query as { period?: string; start?: string; end?: string };
    if (!period) return [];
    return db('entries')
      .join('students', 'entries.student_id', 'students.id')
      .join('print_operations', 'entries.print_operation_id', 'print_operations.id')
      .where('students.period', period)
      .modify((q) => {
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
}
