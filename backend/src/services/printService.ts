import { db } from '../db/knex.js';
import type { Knex } from 'knex';
import { getAvailableBalanceTx, getDailyQuota } from './quotaService.js';
import { StackedDebit } from '../types/index.js';
import { logger } from '../lib/logger.js';

interface PrintRequest {
  operator_id: number;
  primary_student_id: number;
  total_sheets: number;
  stacked_debits: StackedDebit[];
  identify_method: 'manual' | 'rfid' | 'facial';
}

export async function registerPrint(req: PrintRequest) {
  const { operator_id, primary_student_id, total_sheets, stacked_debits, identify_method } = req;

  const debitIds = stacked_debits.map((d) => d.student_id);
  if (new Set(debitIds).size !== debitIds.length) {
    throw new Error('DUPLICATE_STUDENT_IN_DEBITS');
  }

  return db.transaction(async (trx) => {
    // Lock all student rows involved to prevent race conditions
    const studentIds = [...new Set([primary_student_id, ...stacked_debits.map((d) => d.student_id)])];

    await trx('students').whereIn('id', studentIds).forUpdate();

    // Verify balances are still valid
    for (const debit of stacked_debits) {
      const available = await getAvailableBalanceTx(trx, debit.student_id);
      if (available < debit.sheets_to_debit) {
        throw new Error(`INSUFFICIENT_BALANCE:${debit.registration_number}`);
      }
    }

    const [operation] = await trx('print_operations')
      .insert({
        operator_id,
        student_id: primary_student_id,
        total_sheets,
        status: 'completed',
        identify_method,
      })
      .returning('*');

    for (const debit of stacked_debits) {
      const type = debit.student_id === primary_student_id ? 'own' : 'borrowed';
      await trx('entries').insert({
        print_operation_id: operation.id,
        student_id: debit.student_id,
        sheets: debit.sheets_to_debit,
        type,
        identify_method: debit.identify_method ?? (type === 'own' ? identify_method : 'manual'),
      });
    }

    logger.info({ operation_id: operation.id, total_sheets, stacked: stacked_debits.length }, 'Print registered');
    return operation;
  });
}

export async function registerContingencyPrint(operator_id: number, registration_number: string, sheets: number) {
  return db.transaction(async (trx) => {
    let student = await trx('students').where('registration_number', registration_number).first();
    if (!student) {
      const [inserted] = await trx('students')
        .insert({
          registration_number,
          name: registration_number,
          course: '',
          period: '',
          person_code: null,
          sync_status: 'pending',
        })
        .returning('*');
      student = inserted;
    }

    const [operation] = await trx('print_operations')
      .insert({
        operator_id,
        student_id: student.id,
        total_sheets: sheets,
        status: 'contingency',
      })
      .returning('*');

    await trx('entries').insert({
      print_operation_id: operation.id,
      student_id: student.id,
      sheets,
      type: 'own',
    });

    return operation;
  });
}

export async function calculateStackedDebits(
  primaryStudentId: number,
  totalSheets: number,
  extraStudentIds: number[]
): Promise<StackedDebit[]> {
  const uniqueExtras = [...new Set(extraStudentIds)].filter((id) => id !== primaryStudentId);
  const allIds = [primaryStudentId, ...uniqueExtras];
  const students = await db('students').whereIn('id', allIds);
  const quota = await getDailyQuota();

  const debits: StackedDebit[] = [];
  let remaining = totalSheets;

  for (const id of allIds) {
    if (remaining <= 0) break;
    const s = students.find((st) => st.id === id);
    if (!s) continue;

    const available = await (async () => {
      const result = await db('entries')
        .join('print_operations', 'entries.print_operation_id', 'print_operations.id')
        .where('entries.student_id', id)
        .whereRaw(`DATE(print_operations.created_at AT TIME ZONE 'America/Sao_Paulo') = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date`)
        .sum('entries.sheets as total')
        .first();
      const consumed = result?.total ? parseInt(String(result.total), 10) : 0;
      return Math.max(0, quota - consumed);
    })();

    if (available === 0) continue;

    const toDebit = Math.min(available, remaining);
    remaining -= toDebit;

    debits.push({
      student_id: s.id,
      registration_number: s.registration_number,
      name: s.name,
      available,
      sheets_to_debit: toDebit,
    });
  }

  if (remaining > 0) {
    throw new Error('INSUFFICIENT_TOTAL_BALANCE');
  }

  return debits;
}

export async function adjustEntry(
  entryId: number,
  newSheets: number,
  operatorId: number,
  reason: string
) {
  return db.transaction(async (trx) => {
    const entry = await trx('entries').where('id', entryId).first();
    if (!entry) throw new Error('ENTRY_NOT_FOUND');

    await trx('entries').where('id', entryId).update({ sheets: newSheets });

    await trx('audit_log').insert({
      entry_id: entryId,
      operator_id: operatorId,
      previous_value: entry.sheets,
      new_value: newSheets,
      reason,
    });

    return entry;
  });
}
