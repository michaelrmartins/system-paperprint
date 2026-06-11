export type UserType = 'student' | 'employee';

export function detectUserType(doc: string): UserType {
  return doc.length > 8 ? 'student' : 'employee';
}
