export type UserRole = 'operator' | 'auditor' | 'admin';

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
  sync_status: 'synced' | 'pending' | 'attention';
}

export interface IdentifyResult {
  student: Student;
  photo: string | null;
  available_balance: number;
  daily_consumed: number;
  lyceum_active: boolean;
  confidence?: number;
  box?: { top: number; right: number; bottom: number; left: number };
}

export interface StackedDebit {
  student_id: number;
  registration_number: string;
  name: string;
  available: number;
  sheets_to_debit: number;
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
  student_id: number;
  sheets: number;
  type: 'own' | 'borrowed';
  created_at: string;
  student_name?: string;
  registration_number?: string;
}

export interface PrintOperation {
  id: number;
  operator_id: number;
  student_id: number;
  total_sheets: number;
  status: 'completed' | 'contingency' | 'attention';
  created_at: string;
  student_name?: string;
  registration_number?: string;
  operator_login?: string;
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
  student_name: string;
  registration_number: string;
}

export interface SystemUser {
  id: number;
  login: string;
  role: UserRole;
  active: boolean;
  created_at: string;
}
