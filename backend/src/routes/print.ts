import { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import { registerPrint, registerContingencyPrint, calculateStackedDebits, adjustEntry } from '../services/printService.js';
import { JwtPayload, StackedDebit, UserType } from '../types/index.js';
import { detectUserType } from '../lib/documentUtils.js';
import { db } from '../db/knex.js';
import { broadcast } from '../lib/sseEmitter.js';

export async function printRoutes(app: FastifyInstance) {
  // Preview stacked debits before confirming — polymorphic
  app.post('/print/preview-stack', { preHandler: requireAuth(['operator', 'admin']) }, async (req, reply) => {
    const { primary_user_id, primary_user_type, total_sheets, extra_users } = req.body as {
      primary_user_id: number;
      primary_user_type: UserType;
      total_sheets: number;
      extra_users: Array<{ user_id: number; user_type: UserType }>;
    };

    if (!primary_user_id || !primary_user_type || !total_sheets || total_sheets <= 0) {
      return reply.status(400).send({ error: 'INVALID_REQUEST' });
    }

    try {
      const debits = await calculateStackedDebits(
        primary_user_id,
        primary_user_type,
        total_sheets,
        extra_users || []
      );
      return { debits };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'UNKNOWN_ERROR';
      if (msg === 'INSUFFICIENT_TOTAL_BALANCE') {
        return reply.status(422).send({ error: 'INSUFFICIENT_TOTAL_BALANCE' });
      }
      throw err;
    }
  });

  // Confirm and register a print operation — polymorphic
  app.post('/print/register', { preHandler: requireAuth(['operator', 'admin']) }, async (req, reply) => {
    const operator = req.user as JwtPayload;
    const { primary_user_id, primary_user_type, total_sheets, stacked_debits, identify_method } = req.body as {
      primary_user_id: number;
      primary_user_type: UserType;
      total_sheets: number;
      stacked_debits: StackedDebit[];
      identify_method?: 'manual' | 'rfid' | 'facial';
    };

    if (!primary_user_id || !primary_user_type || !total_sheets || !stacked_debits?.length) {
      return reply.status(400).send({ error: 'INVALID_REQUEST' });
    }

    try {
      const operation = await registerPrint({
        operator_id: operator.sub,
        primary_user_id,
        primary_user_type,
        total_sheets,
        stacked_debits,
        identify_method: identify_method || 'manual',
      });
      broadcast('print_registered', { operation_id: operation.id });
      return { operation_id: operation.id, status: operation.status };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.startsWith('INSUFFICIENT_BALANCE')) {
        return reply.status(409).send({ error: msg });
      }
      if (msg === 'DUPLICATE_USER_IN_DEBITS') {
        return reply.status(400).send({ error: 'DUPLICATE_USER_IN_DEBITS' });
      }
      throw err;
    }
  });

  // Contingency mode — auto-detects user_type from identifier when not provided
  app.post('/print/contingency', { preHandler: requireAuth(['operator', 'admin']) }, async (req, reply) => {
    const operator = req.user as JwtPayload;
    const { identifier, sheets, user_type } = req.body as {
      identifier: string;
      sheets: number;
      user_type?: UserType;
    };

    if (!identifier || !sheets || sheets <= 0) {
      return reply.status(400).send({ error: 'INVALID_REQUEST' });
    }

    const resolvedType: UserType = user_type ?? detectUserType(identifier);

    const operation = await registerContingencyPrint(operator.sub, identifier, sheets, resolvedType);
    broadcast('print_registered', { operation_id: operation.id });
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

  // Get recent print operations (last N, ordered by created_at DESC) — dual JOIN
  app.get('/print/operations/recent', { preHandler: requireAuth(['operator', 'auditor', 'admin']) }, async (req) => {
    const { limit: limitParam } = req.query as { limit?: string };
    const limit = Math.max(1, Math.min(parseInt(limitParam ?? '10') || 10, 200));

    const operations = await db('print_operations')
      .leftJoin('students', function () {
        this.on('print_operations.user_type', db.raw("'student'"))
          .andOn('print_operations.user_id', 'students.id');
      })
      .leftJoin('employees', function () {
        this.on('print_operations.user_type', db.raw("'employee'"))
          .andOn('print_operations.user_id', 'employees.id');
      })
      .join('system_users', 'print_operations.operator_id', 'system_users.id')
      .whereRaw("print_operations.created_at >= CURRENT_DATE")
      .select(
        'print_operations.*',
        db.raw("COALESCE(students.name, employees.name) as user_name"),
        db.raw("COALESCE(students.registration_number, employees.employee_code) as user_identifier"),
        db.raw("COALESCE(students.course, employees.department, '') as user_detail"),
        'print_operations.user_type',
        'system_users.login as operator_login'
      )
      .orderBy('print_operations.created_at', 'desc')
      .limit(limit);

    if (operations.length === 0) return { operations: [] };

    const operationIds = operations.map((op) => op.id);

    const allEntries = await db('entries')
      .leftJoin('students', function () {
        this.on('entries.user_type', db.raw("'student'")).andOn('entries.user_id', 'students.id');
      })
      .leftJoin('employees', function () {
        this.on('entries.user_type', db.raw("'employee'")).andOn('entries.user_id', 'employees.id');
      })
      .whereIn('entries.print_operation_id', operationIds)
      .select(
        'entries.*',
        db.raw("COALESCE(students.name, employees.name) as user_name"),
        db.raw("COALESCE(students.registration_number, employees.employee_code) as user_identifier"),
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

  // Get single operation with entries — dual JOIN
  app.get('/print/operations/:id', { preHandler: requireAuth(['operator', 'auditor', 'admin']) }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const operation = await db('print_operations')
      .leftJoin('students', function () {
        this.on('print_operations.user_type', db.raw("'student'"))
          .andOn('print_operations.user_id', 'students.id');
      })
      .leftJoin('employees', function () {
        this.on('print_operations.user_type', db.raw("'employee'"))
          .andOn('print_operations.user_id', 'employees.id');
      })
      .join('system_users', 'print_operations.operator_id', 'system_users.id')
      .where('print_operations.id', parseInt(id))
      .select(
        'print_operations.*',
        db.raw("COALESCE(students.name, employees.name) as user_name"),
        db.raw("COALESCE(students.registration_number, employees.employee_code) as user_identifier"),
        db.raw("COALESCE(students.course, employees.department, '') as user_detail"),
        'print_operations.user_type',
        'system_users.login as operator_login'
      )
      .first();

    if (!operation) return reply.status(404).send({ error: 'NOT_FOUND' });

    const entries = await db('entries')
      .leftJoin('students', function () {
        this.on('entries.user_type', db.raw("'student'")).andOn('entries.user_id', 'students.id');
      })
      .leftJoin('employees', function () {
        this.on('entries.user_type', db.raw("'employee'")).andOn('entries.user_id', 'employees.id');
      })
      .where('entries.print_operation_id', parseInt(id))
      .select(
        'entries.*',
        db.raw("COALESCE(students.name, employees.name) as user_name"),
        db.raw("COALESCE(students.registration_number, employees.employee_code) as user_identifier"),
      );

    return { operation, entries };
  });
}
