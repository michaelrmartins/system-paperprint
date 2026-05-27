import { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db/knex.js';
import { JwtPayload, UserType, StackedDebit } from '../types/index.js';
import { registerBlankWaste } from '../services/printService.js';
import { logger } from '../lib/logger.js';

export async function wasteRoutes(app: FastifyInstance) {
  // Register a print waste event.
  // For type='blank': user_id, user_type, and stacked_debits are required — quota is enforced.
  // For type='error': no user linkage, no quota impact.
  app.post('/waste', { preHandler: requireAuth(['operator', 'admin']) }, async (req, reply) => {
    const { type, sheets, user_id, user_type, stacked_debits } = req.body as {
      type?: string;
      sheets?: number;
      user_id?: number;
      user_type?: UserType;
      stacked_debits?: StackedDebit[];
    };

    if (!type || !['error', 'blank'].includes(type)) {
      return reply.status(400).send({ error: 'INVALID_REQUEST' });
    }
    if (!sheets || !Number.isInteger(sheets) || sheets < 1) {
      return reply.status(400).send({ error: 'INVALID_REQUEST' });
    }

    const operator_id = (req.user as JwtPayload).sub;

    if (type === 'blank') {
      if (!user_id || !user_type || !['student', 'employee'].includes(user_type)) {
        return reply.status(400).send({ error: 'MISSING_USER' });
      }
      if (!stacked_debits?.length) {
        return reply.status(400).send({ error: 'MISSING_STACKED_DEBITS' });
      }

      try {
        const { waste } = await registerBlankWaste(operator_id, user_id, user_type, sheets, stacked_debits);
        return waste;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '';
        if (msg.startsWith('INSUFFICIENT_BALANCE')) return reply.status(409).send({ error: msg });
        if (msg === 'DUPLICATE_USER_IN_DEBITS') return reply.status(400).send({ error: 'DUPLICATE_USER_IN_DEBITS' });
        throw err;
      }
    }

    const [event] = await db('print_waste').insert({ type, sheets, operator_id }).returning('*');
    return event;
  });

  // Adjust sheets on a waste record (operator/admin, audited)
  app.patch('/waste/:id', { preHandler: requireAuth(['operator', 'admin']) }, async (req, reply) => {
    const operator = req.user as JwtPayload;
    const { id } = req.params as { id: string };
    const { sheets, reason } = req.body as { sheets?: number; reason?: string };

    if (sheets == null || !Number.isInteger(sheets) || sheets < 0 || !reason?.trim()) {
      return reply.status(400).send({ error: 'MISSING_FIELDS' });
    }

    const event = await db('print_waste').where('id', id).first();
    if (!event) return reply.status(404).send({ error: 'NOT_FOUND' });

    await db.transaction(async (trx) => {
      await trx('print_waste').where('id', id).update({ sheets });
      await trx('audit_log').insert({
        waste_id: parseInt(id),
        operator_id: operator.sub,
        previous_value: event.sheets,
        new_value: sheets,
        reason: reason.trim(),
      });
      logger.info({ waste_id: id, previous_value: event.sheets, new_value: sheets }, 'Waste record adjusted');
    });

    return { ok: true };
  });

  // Recent waste events with entries for blank type — used by AdjustEntryPage
  app.get('/waste/recent', { preHandler: requireAuth(['operator', 'auditor', 'admin']) }, async (req) => {
    const { limit: limitParam } = req.query as { limit?: string };
    const limit = Math.max(1, Math.min(parseInt(limitParam ?? '20') || 20, 100));

    const events = await db('print_waste')
      .join('system_users', 'print_waste.operator_id', 'system_users.id')
      .leftJoin('students', function () {
        this.on('print_waste.user_type', db.raw("'student'")).andOn('print_waste.user_id', 'students.id');
      })
      .leftJoin('employees', function () {
        this.on('print_waste.user_type', db.raw("'employee'")).andOn('print_waste.user_id', 'employees.id');
      })
      .orderBy('print_waste.created_at', 'desc')
      .limit(limit)
      .select(
        'print_waste.*',
        'system_users.login as operator_login',
        db.raw("COALESCE(students.name, employees.name) as user_name"),
        db.raw("COALESCE(students.registration_number, employees.employee_code) as user_identifier"),
      );

    const blankOpIds = (events as Array<{ type: string; print_operation_id?: number }>)
      .filter(e => e.type === 'blank' && e.print_operation_id)
      .map(e => e.print_operation_id as number);

    let entriesByOp: Record<number, unknown[]> = {};
    if (blankOpIds.length > 0) {
      const entries = await db('entries')
        .leftJoin('students', function () {
          this.on('entries.user_type', db.raw("'student'")).andOn('entries.user_id', 'students.id');
        })
        .leftJoin('employees', function () {
          this.on('entries.user_type', db.raw("'employee'")).andOn('entries.user_id', 'employees.id');
        })
        .whereIn('entries.print_operation_id', blankOpIds)
        .select(
          'entries.*',
          db.raw("COALESCE(students.name, employees.name) as user_name"),
          db.raw("COALESCE(students.registration_number, employees.employee_code) as user_identifier"),
        );
      for (const entry of entries) {
        const key = (entry as { print_operation_id: number }).print_operation_id;
        if (!entriesByOp[key]) entriesByOp[key] = [];
        entriesByOp[key].push(entry);
      }
    }

    return {
      events: (events as Array<Record<string, unknown>>).map(e => ({
        ...e,
        entries: e.print_operation_id ? (entriesByOp[e.print_operation_id as number] ?? []) : [],
      })),
    };
  });

  // Today's waste summary — used by PrintFlowPage sidebar
  app.get('/waste/today', { preHandler: requireAuth(['operator', 'auditor', 'admin']) }, async () => {
    const events = await db('print_waste')
      .join('system_users', 'print_waste.operator_id', 'system_users.id')
      .leftJoin('students', function () {
        this.on('print_waste.user_type', db.raw("'student'")).andOn('print_waste.user_id', 'students.id');
      })
      .leftJoin('employees', function () {
        this.on('print_waste.user_type', db.raw("'employee'")).andOn('print_waste.user_id', 'employees.id');
      })
      .whereRaw(`DATE(print_waste.created_at AT TIME ZONE 'America/Sao_Paulo') = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date`)
      .select(
        'print_waste.*',
        'system_users.login as operator_login',
        db.raw("COALESCE(students.name, employees.name) as user_name"),
        db.raw("COALESCE(students.registration_number, employees.employee_code) as user_identifier"),
      )
      .orderBy('print_waste.created_at', 'desc');

    type WasteEvent = { type: string; sheets: number };
    return {
      error_sheets: (events as WasteEvent[]).filter((e) => e.type === 'error').reduce((s, e) => s + e.sheets, 0),
      blank_sheets: (events as WasteEvent[]).filter((e) => e.type === 'blank').reduce((s, e) => s + e.sheets, 0),
      events,
    };
  });

  // Date-range waste summary — used by ReportsPage
  app.get('/waste/summary', { preHandler: requireAuth(['operator', 'auditor', 'admin']) }, async (req) => {
    const { start, end } = req.query as { start?: string; end?: string };

    const events = await db('print_waste')
      .join('system_users', 'print_waste.operator_id', 'system_users.id')
      .leftJoin('students', function () {
        this.on('print_waste.user_type', db.raw("'student'")).andOn('print_waste.user_id', 'students.id');
      })
      .leftJoin('employees', function () {
        this.on('print_waste.user_type', db.raw("'employee'")).andOn('print_waste.user_id', 'employees.id');
      })
      .modify((q) => {
        if (start) q.where('print_waste.created_at', '>=', start);
        if (end) q.where('print_waste.created_at', '<=', `${end} 23:59:59`);
      })
      .select(
        'print_waste.*',
        'system_users.login as operator_login',
        db.raw("COALESCE(students.name, employees.name) as user_name"),
        db.raw("COALESCE(students.registration_number, employees.employee_code) as user_identifier"),
      )
      .orderBy('print_waste.created_at', 'desc');

    const byDate = await db('print_waste')
      .modify((q) => {
        if (start) q.where('created_at', '>=', start);
        if (end) q.where('created_at', '<=', `${end} 23:59:59`);
      })
      .groupByRaw(`DATE(created_at AT TIME ZONE 'America/Sao_Paulo'), type`)
      .select(
        db.raw(`DATE(created_at AT TIME ZONE 'America/Sao_Paulo') as day`),
        'type',
        db.raw('SUM(sheets)::int as total_sheets'),
        db.raw('COUNT(*)::int as total_events'),
      )
      .orderBy('day', 'desc');

    type WasteEvent = { type: string; sheets: number };
    return {
      error_sheets: (events as WasteEvent[]).filter((e) => e.type === 'error').reduce((s, e) => s + e.sheets, 0),
      blank_sheets: (events as WasteEvent[]).filter((e) => e.type === 'blank').reduce((s, e) => s + e.sheets, 0),
      total_events: events.length,
      events,
      by_date: byDate,
    };
  });
}
