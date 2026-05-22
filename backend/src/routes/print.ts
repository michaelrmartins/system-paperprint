import { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import { registerPrint, registerContingencyPrint, calculateStackedDebits, adjustEntry } from '../services/printService.js';
import { JwtPayload } from '../types/index.js';
import { db } from '../db/knex.js';

export async function printRoutes(app: FastifyInstance) {
  // Preview stacked debits before confirming
  app.post('/print/preview-stack', { preHandler: requireAuth(['operator', 'admin']) }, async (req, reply) => {
    const { primary_student_id, total_sheets, extra_student_ids } = req.body as {
      primary_student_id: number;
      total_sheets: number;
      extra_student_ids: number[];
    };

    if (!primary_student_id || !total_sheets || total_sheets <= 0) {
      return reply.status(400).send({ error: 'INVALID_REQUEST' });
    }

    try {
      const debits = await calculateStackedDebits(primary_student_id, total_sheets, extra_student_ids || []);
      return { debits };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'UNKNOWN_ERROR';
      if (msg === 'INSUFFICIENT_TOTAL_BALANCE') {
        return reply.status(422).send({ error: 'INSUFFICIENT_TOTAL_BALANCE' });
      }
      throw err;
    }
  });

  // Confirm and register a print operation
  app.post('/print/register', { preHandler: requireAuth(['operator', 'admin']) }, async (req, reply) => {
    const operator = req.user as JwtPayload;
    const { primary_student_id, total_sheets, stacked_debits, identify_method } = req.body as {
      primary_student_id: number;
      total_sheets: number;
      stacked_debits: Array<{ student_id: number; registration_number: string; name: string; available: number; sheets_to_debit: number }>;
      identify_method?: 'manual' | 'rfid' | 'facial';
    };

    if (!primary_student_id || !total_sheets || !stacked_debits?.length) {
      return reply.status(400).send({ error: 'INVALID_REQUEST' });
    }

    try {
      const operation = await registerPrint({
        operator_id: operator.sub,
        primary_student_id,
        total_sheets,
        stacked_debits,
        identify_method: identify_method || 'manual',
      });
      return { operation_id: operation.id, status: operation.status };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.startsWith('INSUFFICIENT_BALANCE')) {
        return reply.status(409).send({ error: msg });
      }
      if (msg === 'DUPLICATE_STUDENT_IN_DEBITS') {
        return reply.status(400).send({ error: 'DUPLICATE_STUDENT_IN_DEBITS' });
      }
      throw err;
    }
  });

  // Contingency mode
  app.post('/print/contingency', { preHandler: requireAuth(['operator', 'admin']) }, async (req, reply) => {
    const operator = req.user as JwtPayload;
    const { registration_number, sheets } = req.body as { registration_number: string; sheets: number };

    if (!registration_number || !sheets || sheets <= 0) {
      return reply.status(400).send({ error: 'INVALID_REQUEST' });
    }

    const operation = await registerContingencyPrint(operator.sub, registration_number, sheets);
    return { operation_id: operation.id, status: operation.status };
  });

  // Adjust entry (operator with audit log)
  app.patch('/print/entries/:id', { preHandler: requireAuth(['operator', 'admin']) }, async (req, reply) => {
    const operator = req.user as JwtPayload;
    const { id } = req.params as { id: string };
    const { sheets, reason } = req.body as { sheets: number; reason: string };

    if (sheets == null || sheets < 0 || !reason?.trim()) {
      return reply.status(400).send({ error: 'MISSING_FIELDS' });
    }

    try {
      await adjustEntry(parseInt(id), sheets, operator.sub, reason.trim());
      return { ok: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'ENTRY_NOT_FOUND') return reply.status(404).send({ error: 'ENTRY_NOT_FOUND' });
      throw err;
    }
  });

  // Get recent print operations (last N, ordered by created_at DESC)
  app.get('/print/operations/recent', { preHandler: requireAuth(['operator', 'auditor', 'admin']) }, async (req) => {
    const { limit: limitParam } = req.query as { limit?: string };
    const limit = Math.max(1, Math.min(parseInt(limitParam ?? '10') || 10, 200));

    const operations = await db('print_operations')
      .join('students', 'print_operations.student_id', 'students.id')
      .join('system_users', 'print_operations.operator_id', 'system_users.id')
      .select(
        'print_operations.*',
        'students.name as student_name',
        'students.registration_number',
        'students.course as student_course',
        'students.period as student_period',
        'system_users.login as operator_login'
      )
      .orderBy('print_operations.created_at', 'desc')
      .limit(limit);

    if (operations.length === 0) return { operations: [] };

    const operationIds = operations.map((op) => op.id);

    const allEntries = await db('entries')
      .join('students', 'entries.student_id', 'students.id')
      .whereIn('entries.print_operation_id', operationIds)
      .select(
        'entries.*',
        'students.name as student_name',
        'students.registration_number'
      );

    const entriesByOperation = allEntries.reduce<Record<number, typeof allEntries>>((acc, entry) => {
      const key = entry.print_operation_id as number;
      if (!acc[key]) acc[key] = [];
      acc[key].push(entry);
      return acc;
    }, {});

    const result = operations.map((op) => ({
      ...op,
      entries: entriesByOperation[op.id as number] ?? [],
    }));

    return { operations: result };
  });

  // Get single operation with entries
  app.get('/print/operations/:id', { preHandler: requireAuth(['operator', 'auditor', 'admin']) }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const operation = await db('print_operations')
      .join('students', 'print_operations.student_id', 'students.id')
      .join('system_users', 'print_operations.operator_id', 'system_users.id')
      .where('print_operations.id', parseInt(id))
      .select(
        'print_operations.*',
        'students.name as student_name',
        'students.registration_number',
        'system_users.login as operator_login'
      )
      .first();

    if (!operation) return reply.status(404).send({ error: 'NOT_FOUND' });

    const entries = await db('entries')
      .join('students', 'entries.student_id', 'students.id')
      .where('entries.print_operation_id', parseInt(id))
      .select('entries.*', 'students.name as student_name', 'students.registration_number');

    return { operation, entries };
  });
}
