export type UserType = 'student' | 'employee';

export function detectUserType(doc: string): UserType {
  // Student: exactly 10 digits starting with "20" (format: YYYY+sem+course+seq)
  return /^\d{10}$/.test(doc) && doc.startsWith('20') ? 'student' : 'employee';
}
