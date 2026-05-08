import { db } from '../db/knex.js';
import type { Knex } from 'knex';

export async function getDailyQuota(): Promise<number> {
  const row = await db('settings').where('key', 'daily_quota').first();
  return row ? parseInt(row.value, 10) : 10;
}

export async function getDailyConsumed(studentId: number): Promise<number> {
  const result = await db('entries')
    .join('print_operations', 'entries.print_operation_id', 'print_operations.id')
    .where('entries.student_id', studentId)
    .whereRaw(`DATE(print_operations.created_at AT TIME ZONE 'America/Sao_Paulo') = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date`)
    .sum('entries.sheets as total')
    .first();

  return result?.total ? parseInt(String(result.total), 10) : 0;
}

export async function getAvailableBalance(studentId: number): Promise<number> {
  const [quota, consumed] = await Promise.all([
    getDailyQuota(),
    getDailyConsumed(studentId),
  ]);
  return Math.max(0, quota - consumed);
}

export async function getAvailableBalanceTx(
  trx: Knex.Transaction,
  studentId: number
): Promise<number> {
  const quotaRow = await trx('settings').where('key', 'daily_quota').first();
  const quota = quotaRow ? parseInt(quotaRow.value, 10) : 10;

  const result = await trx('entries')
    .join('print_operations', 'entries.print_operation_id', 'print_operations.id')
    .where('entries.student_id', studentId)
    .whereRaw(`DATE(print_operations.created_at AT TIME ZONE 'America/Sao_Paulo') = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date`)
    .sum('entries.sheets as total')
    .first();

  const consumed = result?.total ? parseInt(String(result.total), 10) : 0;
  return Math.max(0, quota - consumed);
}
