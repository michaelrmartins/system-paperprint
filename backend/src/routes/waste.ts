import { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db/knex.js';
import { JwtPayload } from '../types/index.js';

export async function wasteRoutes(app: FastifyInstance) {
  // Register a print waste event (error or blank pages)
  app.post('/waste', { preHandler: requireAuth(['operator', 'admin']) }, async (req, reply) => {
    const { type, sheets } = req.body as { type?: string; sheets?: number };
    if (!type || !['error', 'blank'].includes(type)) {
      return reply.status(400).send({ error: 'INVALID_REQUEST' });
    }
    if (!sheets || !Number.isInteger(sheets) || sheets < 1) {
      return reply.status(400).send({ error: 'INVALID_REQUEST' });
    }
    const operator_id = (req.user as JwtPayload).sub;
    const [event] = await db('print_waste').insert({ type, sheets, operator_id }).returning('*');
    return event;
  });

  // Today's waste summary — used by PrintFlowPage sidebar
  app.get('/waste/today', { preHandler: requireAuth(['operator', 'auditor', 'admin']) }, async () => {
    const events = await db('print_waste')
      .join('system_users', 'print_waste.operator_id', 'system_users.id')
      .whereRaw(`DATE(print_waste.created_at AT TIME ZONE 'America/Sao_Paulo') = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date`)
      .select('print_waste.*', 'system_users.login as operator_login')
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
      .modify((q) => {
        if (start) q.where('print_waste.created_at', '>=', start);
        if (end) q.where('print_waste.created_at', '<=', `${end} 23:59:59`);
      })
      .select('print_waste.*', 'system_users.login as operator_login')
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
