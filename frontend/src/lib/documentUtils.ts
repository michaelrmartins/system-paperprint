export type UserType = 'student' | 'employee';

export function detectUserType(doc: string): UserType {
  return /^\d{10}$/.test(doc) && doc.startsWith('20') ? 'student' : 'employee';
}
