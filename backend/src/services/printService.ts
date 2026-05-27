import { db } from '../db/knex.js';
import type { Knex } from 'knex';
import { getAvailableBalanceTx } from './quotaService.js';
import { StackedDebit, UserType } from '../types/index.js';
import { logger } from '../lib/logger.js';

interface PrintRequest {
  operator_id: number;
  primary_user_id: number;
  primary_user_type: UserType;
  total_sheets: number;
  stacked_debits: StackedDebit[];
  identify_method: 'manual' | 'rfid' | 'facial';
}

export async function registerPrint(req: PrintRequest) {
  const { operator_id, primary_user_id, primary_user_type, total_sheets, stacked_debits, identify_method } = req;

  const debitKeys = stacked_debits.map((d) => `${d.user_type}:${d.user_id}`);
  if (new Set(debitKeys).size !== debitKeys.length) throw new Error('DUPLICATE_USER_IN_DEBITS');

  return db.transaction(async (trx) => {
    // Lock all involved rows to prevent race conditions on concurrent debits
    const studentIds = [...new Set(stacked_debits.filter(d => d.user_type === 'student').map(d => d.user_id))];
    const employeeIds = [...new Set(stacked_debits.filter(d => d.user_type === 'employee').map(d => d.user_id))];

    if (studentIds.length > 0) await trx('students').whereIn('id', studentIds).forUpdate();
    if (employeeIds.length > 0) await trx('employees').whereIn('id', employeeIds).forUpdate();

    // Verify balances are still valid under lock
    for (const debit of stacked_debits) {
      const available = await getAvailableBalanceTx(trx, debit.user_id, debit.user_type);
      if (available < debit.sheets_to_debit) {
        throw new Error(`INSUFFICIENT_BALANCE:${debit.identifier}`);
      }
    }

    const [operation] = await trx('print_operations')
      .insert({
        operator_id,
        user_type: primary_user_type,
        user_id: primary_user_id,
        student_id: primary_user_type === 'student' ? primary_user_id : null,
        total_sheets,
        status: 'completed',
        identify_method,
      })
      .returning('*');

    for (const debit of stacked_debits) {
      const isPrimary = debit.user_id === primary_user_id && debit.user_type === primary_user_type;
      const type = isPrimary ? 'own' : 'borrowed';
      await trx('entries').insert({
        print_operation_id: operation.id,
        user_type: debit.user_type,
        user_id: debit.user_id,
        student_id: debit.user_type === 'student' ? debit.user_id : null,
        sheets: debit.sheets_to_debit,
        type,
        identify_method: debit.identify_method ?? (isPrimary ? identify_method : 'manual'),
      });
    }

    logger.info({ operation_id: operation.id, total_sheets, stacked: stacked_debits.length }, 'Print registered');
    return operation;
  });
}

export async function registerContingencyPrint(
  operator_id: number,
  identifier: string,
  sheets: number,
  userType: UserType = 'student'
) {
  return db.transaction(async (trx) => {
    let userId: number;

    if (userType === 'student') {
      let student = await trx('students').where('registration_number', identifier).first();
      if (!student) {
        const [inserted] = await trx('students')
          .insert({
            registration_number: identifier,
            name: identifier,
            course: '',
            period: '',
            person_code: null,
            sync_status: 'pending',
          })
          .returning('*');
        student = inserted;
      }
      userId = student.id;
    } else {
      let employee = await trx('employees').where('employee_code', identifier).first();
      if (!employee) {
        const [inserted] = await trx('employees')
          .insert({
            employee_code: identifier,
            name: identifier,
            department: '',
            email: null,
            sync_status: 'pending',
          })
          .returning('*');
        employee = inserted;
      }
      userId = employee.id;
    }

    const [operation] = await trx('print_operations')
      .insert({
        operator_id,
        user_type: userType,
        user_id: userId,
        student_id: userType === 'student' ? userId : null,
        total_sheets: sheets,
        status: 'contingency',
      })
      .returning('*');

    await trx('entries').insert({
      print_operation_id: operation.id,
      user_type: userType,
      user_id: userId,
      student_id: userType === 'student' ? userId : null,
      sheets,
      type: 'own',
    });

    return operation;
  });
}

export async function calculateStackedDebits(
  primaryUserId: number,
  primaryUserType: UserType,
  totalSheets: number,
  extras: Array<{ user_id: number; user_type: UserType }>
): Promise<StackedDebit[]> {
  // Load stacking rules from settings
  const settingRows = await db('settings').whereIn('key', [
    'daily_quota', 'employee_daily_quota',
    'allow_cross_type_stacking', 'allow_employee_employee_stacking',
  ]);
  const getSetting = (key: string) => settingRows.find(r => r.key === key)?.value ?? '';
  const allowCrossType = getSetting('allow_cross_type_stacking') === 'true';
  const allowEmpEmp = getSetting('allow_employee_employee_stacking') === 'true';
  const studentQuota = parseInt(getSetting('daily_quota') || '10', 10);
  const employeeQuota = parseInt(getSetting('employee_daily_quota') || '10', 10);

  // Filter extras based on stacking rules
  const filteredExtras = extras.filter(({ user_id, user_type }) => {
    if (user_id === primaryUserId && user_type === primaryUserType) return false; // skip duplicate primary
    if (!allowCrossType && user_type !== primaryUserType) return false;
    if (!allowEmpEmp && primaryUserType === 'employee' && user_type === 'employee') return false;
    return true;
  });

  // Deduplicate extras
  const uniqueExtras = filteredExtras.filter(
    (e, i, arr) => arr.findIndex(x => x.user_id === e.user_id && x.user_type === e.user_type) === i
  );
  const allUsers = [{ user_id: primaryUserId, user_type: primaryUserType }, ...uniqueExtras];

  // Fetch student/employee rows in bulk
  const studentIds = allUsers.filter(u => u.user_type === 'student').map(u => u.user_id);
  const employeeIds = allUsers.filter(u => u.user_type === 'employee').map(u => u.user_id);

  const studentRows = studentIds.length ? await db('students').whereIn('id', studentIds) : [];
  const employeeRows = employeeIds.length ? await db('employees').whereIn('id', employeeIds) : [];

  const debits: StackedDebit[] = [];
  let remaining = totalSheets;

  for (const { user_id, user_type } of allUsers) {
    if (remaining <= 0) break;

    let name: string;
    let identifier: string;
    let quota: number;

    if (user_type === 'student') {
      const s = studentRows.find(r => r.id === user_id);
      if (!s) continue;
      name = s.name;
      identifier = s.registration_number;
      quota = studentQuota;
    } else {
      const e = employeeRows.find(r => r.id === user_id);
      if (!e) continue;
      name = e.name;
      identifier = e.employee_code;
      quota = employeeQuota;
    }

    const consumed = await (async () => {
      const result = await db('entries')
        .join('print_operations', 'entries.print_operation_id', 'print_operations.id')
        .where('entries.user_id', user_id)
        .where('entries.user_type', user_type)
        .whereRaw(`DATE(print_operations.created_at AT TIME ZONE 'America/Sao_Paulo') = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date`)
        .sum('entries.sheets as total')
        .first();
      return result?.total ? parseInt(String(result.total), 10) : 0;
    })();

    const available = Math.max(0, quota - consumed);
    if (available === 0) continue;

    const toDebit = Math.min(available, remaining);
    remaining -= toDebit;

    debits.push({ user_id, user_type, identifier, name, available, sheets_to_debit: toDebit });
  }

  if (remaining > 0) throw new Error('INSUFFICIENT_TOTAL_BALANCE');
  return debits;
}

export async function registerBlankWaste(
  operatorId: number,
  primaryUserId: number,
  primaryUserType: UserType,
  totalSheets: number,
  stackedDebits: StackedDebit[],
) {
  const debitKeys = stackedDebits.map((d) => `${d.user_type}:${d.user_id}`);
  if (new Set(debitKeys).size !== debitKeys.length) throw new Error('DUPLICATE_USER_IN_DEBITS');

  return db.transaction(async (trx) => {
    const studentIds = [...new Set(stackedDebits.filter(d => d.user_type === 'student').map(d => d.user_id))];
    const employeeIds = [...new Set(stackedDebits.filter(d => d.user_type === 'employee').map(d => d.user_id))];

    if (studentIds.length > 0) await trx('students').whereIn('id', studentIds).forUpdate();
    if (employeeIds.length > 0) await trx('employees').whereIn('id', employeeIds).forUpdate();

    for (const debit of stackedDebits) {
      const available = await getAvailableBalanceTx(trx, debit.user_id, debit.user_type);
      if (available < debit.sheets_to_debit) {
        throw new Error(`INSUFFICIENT_BALANCE:${debit.identifier}`);
      }
    }

    const [operation] = await trx('print_operations').insert({
      operator_id: operatorId,
      user_type: primaryUserType,
      user_id: primaryUserId,
      student_id: primaryUserType === 'student' ? primaryUserId : null,
      total_sheets: totalSheets,
      status: 'completed',
      operation_type: 'blank_waste',
      identify_method: 'manual',
    }).returning('*');

    for (const debit of stackedDebits) {
      const isPrimary = debit.user_id === primaryUserId && debit.user_type === primaryUserType;
      await trx('entries').insert({
        print_operation_id: operation.id,
        user_type: debit.user_type,
        user_id: debit.user_id,
        student_id: debit.user_type === 'student' ? debit.user_id : null,
        sheets: debit.sheets_to_debit,
        type: isPrimary ? 'own' : 'borrowed',
      });
    }

    const [waste] = await trx('print_waste').insert({
      type: 'blank',
      sheets: totalSheets,
      operator_id: operatorId,
      user_type: primaryUserType,
      user_id: primaryUserId,
      print_operation_id: operation.id,
    }).returning('*');

    logger.info({ operation_id: operation.id, total_sheets: totalSheets, stacked: stackedDebits.length }, 'Blank waste registered');
    return { operation, waste };
  });
}

export async function adjustEntry(entryId: number, newSheets: number, operatorId: number, reason: string) {
  const entry = await db('entries').where('id', entryId).first();
  if (!entry) throw new Error('ENTRY_NOT_FOUND');

  await db.transaction(async (trx) => {
    const previousValue = entry.sheets;
    await trx('entries').where('id', entryId).update({ sheets: newSheets });
    await trx('audit_log').insert({
      entry_id: entryId,
      operator_id: operatorId,
      previous_value: previousValue,
      new_value: newSheets,
      reason,
    });
    logger.info({ entry_id: entryId, previous_value: previousValue, new_value: newSheets }, 'Entry adjusted');
  });
}
