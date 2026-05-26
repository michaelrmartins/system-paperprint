import { db } from '../db/knex.js';
import * as lyceumClient from '../clients/lyceumClient.js';
import { Student, IdentifyResult } from '../types/index.js';
import { logger } from '../lib/logger.js';
import { getAvailableBalance, getDailyConsumed } from './quotaService.js';

interface FindOptions {
  /**
   * strict=true: Lyceum MUST return the student. If unreachable or not found → throws.
   * strict=false (default): if Lyceum is unreachable, creates student in contingency.
   */
  strict?: boolean;
  /**
   * force=true: when Lyceum is available but returns 404, proceed in contingency
   * instead of throwing STUDENT_NOT_IN_LYCEUM. Requires explicit operator confirmation.
   */
  force?: boolean;
}

export async function findOrCreateStudent(
  registrationNumber: string,
  options: FindOptions = {}
): Promise<IdentifyResult> {
  const { strict = false } = options;

  let lyceumData = null;
  // lyceumOnline: Lyceum middleware responded (even if student not found — 404 counts as online)
  let lyceumOnline = false;
  // lyceumSynced: we actually received student data from Lyceum
  let lyceumSynced = false;

  try {
    lyceumData = await lyceumClient.getStudentByRegistration(registrationNumber);
    lyceumOnline = true;
    lyceumSynced = true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';

    if (msg === 'STUDENT_NOT_FOUND') {
      // 404 — API is reachable, student simply doesn't exist in Lyceum
      lyceumOnline = true;
      if (!options.force) throw new Error('STUDENT_NOT_IN_LYCEUM');
      logger.warn({ registrationNumber }, 'Student not in Lyceum — proceeding in contingency (forced)');
    } else {
      // 502/503/504 or network error — middleware/upstream is unreachable
      logger.warn({ err, registrationNumber }, 'Lyceum unavailable');
    }
  }

  let student = await db('students').where('registration_number', registrationNumber).first() as Student | undefined;

  // Strict mode: block NEW students only when Lyceum is truly unreachable (not just "student not found")
  if (!lyceumOnline && strict && !student) {
    throw new Error('LYCEUM_UNAVAILABLE');
  }

  if (!student) {
    const [inserted] = await db('students')
      .insert({
        registration_number: registrationNumber,
        name: lyceumData?.nome_compl || registrationNumber,
        course: lyceumData?.nome_curso || '',
        period: lyceumData?.nome_serie || '',
        person_code: lyceumData?.pessoa || null,
        // 'synced' = Lyceum confirmed, 'attention' = Lyceum online but student not found (forced),
        // 'pending' = Lyceum was offline, will sync when it comes back
        sync_status: lyceumSynced ? 'synced' : lyceumOnline ? 'attention' : 'pending',
      })
      .returning('*');
    student = inserted as Student;
  } else if (lyceumSynced && lyceumData) {
    const [updated] = await db('students')
      .where('id', student.id)
      .update({
        name: lyceumData.nome_compl,
        course: lyceumData.nome_curso,
        period: lyceumData.nome_serie,
        person_code: lyceumData.pessoa,
        sync_status: 'synced',
        updated_at: db.fn.now(),
      })
      .returning('*');
    student = updated as Student;
  }

  let photo: string | null = null;
  if (student.person_code) {
    try {
      photo = await lyceumClient.getStudentPhoto(student.person_code);
    } catch {
      // photo is non-critical
    }
  }

  const [available_balance, daily_consumed] = await Promise.all([
    getAvailableBalance(student.id, 'student'),
    getDailyConsumed(student.id, 'student'),
  ]);

  return { user: student, user_type: 'student', photo, available_balance, daily_consumed, source_active: lyceumOnline };
}
