import { db } from '../db/knex.js';
import * as lyceumClient from '../clients/lyceumClient.js';
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
        name: data.nome_compl,
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
        logger.warn({ id: student.id }, 'Student not found in Lyceum — marked as attention');
      } else {
        // Lyceum temporarily unavailable — keep as pending so it retries next cycle
        await db('students').where('id', student.id).update({ sync_status: 'pending', updated_at: db.fn.now() });
        logger.warn({ id: student.id }, 'Student sync failed (Lyceum unavailable) — will retry');
      }
    }
  }
}

export function startSyncWorker() {
  const run = async () => {
    try {
      await syncPendingStudents();
    } catch (err) {
      logger.error({ err }, 'Sync worker error');
    }
  };

  run();
  setInterval(run, INTERVAL_MS);
  logger.info('Sync worker started');
}
