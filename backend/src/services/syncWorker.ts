import { db } from '../db/knex.js';
import * as lyceumClient from '../clients/lyceumClient.js';
import * as nasajonClient from '../clients/nasajonClient.js';
import { logger } from '../lib/logger.js';

const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

async function syncPendingStudents() {
  // Retry both 'pending' (never synced) and 'attention' (previously failed) students
  const pending = await db('students').whereIn('sync_status', ['pending', 'attention']).limit(20);
  if (pending.length === 0) return;
  logger.info({ count: pending.length }, 'Syncing pending/attention students');

  for (const student of pending) {
    try {
      const data = await lyceumClient.getStudentByRegistration(student.registration_number);
      await db('students').where('id', student.id).update({
        name: data.nome_social || data.nome_compl,
        course: data.nome_curso,
        period: data.nome_serie,
        person_code: data.pessoa,
        sync_status: 'synced',
        updated_at: db.fn.now(),
      });
      logger.info({ id: student.id, registration: student.registration_number }, 'Student synced');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'STUDENT_NOT_FOUND') {
        // Student no longer exists in Lyceum — mark attention and stop retrying
        await db('students').where('id', student.id).update({ sync_status: 'attention', updated_at: db.fn.now() });
        logger.warn({ id: student.id, status: 'attention' }, 'Student not found in Lyceum — marked as attention');
      } else {
        // Lyceum temporarily unavailable — keep as pending so it retries next cycle
        await db('students').where('id', student.id).update({ sync_status: 'pending', updated_at: db.fn.now() });
        logger.warn({ id: student.id, status: 'pending' }, 'Student sync failed (Lyceum unavailable) — will retry');
      }
    }
  }
}

async function syncPendingEmployees() {
  const pending = await db('employees').whereIn('sync_status', ['pending', 'attention']).limit(20);
  if (pending.length === 0) return;
  logger.info({ count: pending.length }, 'Syncing pending/attention employees');

  for (const employee of pending) {
    try {
      const data = await nasajonClient.getEmployeeByCode(employee.employee_code);
      await db('employees').where('id', employee.id).update({
        name: data.name,
        department: data.department,
        email: data.email,
        sync_status: 'synced',
        updated_at: db.fn.now(),
      });
      logger.info({ id: employee.id, code: employee.employee_code }, 'Employee synced');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      const status = msg === 'EMPLOYEE_NOT_FOUND' ? 'attention' : 'pending';
      await db('employees').where('id', employee.id).update({ sync_status: status, updated_at: db.fn.now() });
      logger.warn({ id: employee.id, status }, 'Employee sync failed');
    }
  }
}

export function startSyncWorker() {
  const run = async () => {
    try {
      await syncPendingStudents();
      await syncPendingEmployees();
    } catch (err) {
      logger.error({ err }, 'Sync worker error');
    }
  };

  run();
  setInterval(run, INTERVAL_MS);
  logger.info('Sync worker started');
}
