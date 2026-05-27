export type UserType = 'student' | 'employee';

export function detectUserType(doc: string): UserType {
  if (doc.startsWith('0') || doc.startsWith('1')) return 'employee';
  if (doc.startsWith('202') || doc.length > 6) return 'student';
  return 'employee';
}
