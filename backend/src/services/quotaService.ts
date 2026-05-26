import { db } from '../db/knex.js';
import type { Knex } from 'knex';
import type { UserType } from '../types/index.js';

const TODAY_TZ = `DATE(print_operations.created_at AT TIME ZONE 'America/Sao_Paulo') = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date`;

async function getQuotaForType(userType: UserType): Promise<number> {
  const key = userType === 'student' ? 'daily_quota' : 'employee_daily_quota';
  const row = await db('settings').where('key', key).first();
  return row ? parseInt(row.value, 10) : 10;
}

async function getQuotaForTypeTx(trx: Knex.Transaction, userType: UserType): Promise<number> {
  const key = userType === 'student' ? 'daily_quota' : 'employee_daily_quota';
  const row = await trx('settings').where('key', key).first();
  return row ? parseInt(row.value, 10) : 10;
}

export async function getDailyConsumed(userId: number, userType: UserType): Promise<number> {
  const result = await db('entries')
    .join('print_operations', 'entries.print_operation_id', 'print_operations.id')
    .where('entries.user_id', userId)
    .where('entries.user_type', userType)
    .whereRaw(TODAY_TZ)
    .sum('entries.sheets as total')
    .first();
  return result?.total ? parseInt(String(result.total), 10) : 0;
}

export async function getAvailableBalance(userId: number, userType: UserType): Promise<number> {
  const [quota, consumed] = await Promise.all([
    getQuotaForType(userType),
    getDailyConsumed(userId, userType),
  ]);
  return Math.max(0, quota - consumed);
}

export async function getAvailableBalanceTx(trx: Knex.Transaction, userId: number, userType: UserType): Promise<number> {
  const quota = await getQuotaForTypeTx(trx, userType);
  const result = await trx('entries')
    .join('print_operations', 'entries.print_operation_id', 'print_operations.id')
    .where('entries.user_id', userId)
    .where('entries.user_type', userType)
    .whereRaw(TODAY_TZ)
    .sum('entries.sheets as total')
    .first();
  const consumed = result?.total ? parseInt(String(result.total), 10) : 0;
  return Math.max(0, quota - consumed);
}
