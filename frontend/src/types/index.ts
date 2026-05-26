export type UserRole = 'operator' | 'auditor' | 'admin';
export type UserType = 'student' | 'employee';
export type SyncStatus = 'synced' | 'pending' | 'attention';

export interface AuthUser {
  id: number;
  login: string;
  role: UserRole;
}

export interface Student {
  id: number;
  registration_number: string;
  name: string;
  course: string;
  period: string;
  person_code: string | null;
  sync_status: SyncStatus;
}

export interface Employee {
  id: number;
  employee_code: string;
  name: string;
  department: string;
  email: string | null;
  sync_status: SyncStatus;
}

export interface IdentifyResult {
  user: Student | Employee;
  user_type: UserType;
  photo: string | null;
  available_balance: number;
  daily_consumed: number;
  source_active: boolean;
  confidence?: number;
  box?: { top: number; right: number; bottom: number; left: number };
}

export interface StackedDebit {
  user_id: number;
  user_type: UserType;
  identifier: string;
  name: string;
  available: number;
  sheets_to_debit: number;
  identify_method?: 'manual' | 'rfid' | 'facial';
}

export interface Setting {
  key: string;
  value: string;
  description: string;
  updated_at: string;
}

export interface PrintEntry {
  id: number;
  print_operation_id: number;
  user_id: number;
  user_type: UserType;
  sheets: number;
  type: 'own' | 'borrowed';
  created_at: string;
  user_name?: string;
  user_identifier?: string;
  // legacy field kept for backward compat with old API responses
  student_id?: number;
  student_name?: string;
  registration_number?: string;
}

export interface PrintOperation {
  id: number;
  operator_id: number;
  user_id: number;
  user_type: UserType;
  total_sheets: number;
  status: 'completed' | 'contingency' | 'attention';
  created_at: string;
  user_name?: string;
  user_identifier?: string;
  operator_login?: string;
  // legacy
  student_id?: number;
  student_name?: string;
  registration_number?: string;
}

export interface AuditEntry {
  id: number;
  entry_id: number;
  operator_id: number;
  previous_value: number;
  new_value: number;
  reason: string;
  created_at: string;
  operator_login: string;
  user_name?: string;
  user_identifier?: string;
  // legacy
  student_name?: string;
  registration_number?: string;
}

export interface SystemUser {
  id: number;
  login: string;
  role: UserRole;
  active: boolean;
  created_at: string;
}

// Helper: get the identifier (registration or employee code) from any user
export function getUserIdentifier(user: Student | Employee, userType: UserType): string {
  return userType === 'student'
    ? (user as Student).registration_number
    : (user as Employee).employee_code;
}

// Helper: get secondary display info (course/period or department)
export function getUserDetail(user: Student | Employee, userType: UserType): string {
  if (userType === 'student') {
    const s = user as Student;
    return [s.course, s.period].filter(Boolean).join(' · ');
  }
  return (user as Employee).department || '';
}
