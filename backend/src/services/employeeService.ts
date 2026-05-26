import { db } from '../db/knex.js';
import * as nasajonClient from '../clients/nasajonClient.js';
import { Employee, IdentifyResult } from '../types/index.js';
import { logger } from '../lib/logger.js';
import { getAvailableBalance, getDailyConsumed } from './quotaService.js';

interface FindOptions {
  /**
   * strict=true: Nasajon MUST return the employee. If unreachable → throws.
   * strict=false (default): if Nasajon is unreachable, creates employee in contingency.
   */
  strict?: boolean;
  /**
   * force=true: when Nasajon is available but returns 404, proceed in contingency
   * instead of throwing EMPLOYEE_NOT_IN_NASAJON. Requires explicit operator confirmation.
   */
  force?: boolean;
}

export async function findOrCreateEmployee(
  employeeCode: string,
  options: FindOptions = {}
): Promise<IdentifyResult> {
  const { strict = false } = options;

  let nasajonData = null;
  // nasajonOnline: Nasajon API responded (even if employee not found — 404 counts as online)
  let nasajonOnline = false;
  // nasajonSynced: we actually received employee data from Nasajon
  let nasajonSynced = false;
  let photo: string | null = null;

  try {
    nasajonData = await nasajonClient.getEmployeeByCode(employeeCode);
    nasajonOnline = true;
    nasajonSynced = true;
    photo = nasajonData.photo;
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';

    if (msg === 'EMPLOYEE_NOT_FOUND') {
      // 404 — API is reachable, employee simply doesn't exist in Nasajon
      nasajonOnline = true;
      if (!options.force) throw new Error('EMPLOYEE_NOT_IN_NASAJON');
      logger.warn({ employeeCode }, 'Employee not in Nasajon — proceeding in contingency (forced)');
    } else {
      // Network error or 5xx — upstream is unreachable
      logger.warn({ err, employeeCode }, 'Nasajon unavailable');
    }
  }

  // If Nasajon is online and returned data, check termination status before proceeding
  if (nasajonSynced && nasajonData && !nasajonData.active) {
    throw new Error('EMPLOYEE_TERMINATED');
  }

  let employee = await db('employees').where('employee_code', employeeCode).first() as Employee | undefined;

  // Strict mode: block NEW employees only when Nasajon is truly unreachable
  if (!nasajonOnline && strict && !employee) {
    throw new Error('NASAJON_UNAVAILABLE');
  }

  if (!employee) {
    const [inserted] = await db('employees')
      .insert({
        employee_code: employeeCode,
        name: nasajonData?.name || employeeCode,
        department: nasajonData?.department || '',
        email: nasajonData?.email || null,
        // 'synced' = Nasajon confirmed, 'attention' = Nasajon online but not found (forced),
        // 'pending' = Nasajon was offline, will sync when it comes back
        sync_status: nasajonSynced ? 'synced' : nasajonOnline ? 'attention' : 'pending',
      })
      .returning('*');
    employee = inserted as Employee;
  } else if (nasajonSynced && nasajonData) {
    const [updated] = await db('employees')
      .where('id', employee.id)
      .update({
        name: nasajonData.name,
        department: nasajonData.department,
        email: nasajonData.email,
        sync_status: 'synced',
        updated_at: db.fn.now(),
      })
      .returning('*');
    employee = updated as Employee;
  }

  const [available_balance, daily_consumed] = await Promise.all([
    getAvailableBalance(employee.id, 'employee'),
    getDailyConsumed(employee.id, 'employee'),
  ]);

  return { user: employee, user_type: 'employee', photo, available_balance, daily_consumed, source_active: nasajonOnline };
}
