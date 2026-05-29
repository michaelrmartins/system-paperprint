export type UserRole = 'operator' | 'auditor' | 'admin';
export type UserType = 'student' | 'employee';
export type SyncStatus = 'synced' | 'pending' | 'attention';
export type PrintOperationStatus = 'completed' | 'contingency' | 'attention';
export type EntryType = 'own' | 'borrowed';

export interface SystemUser {
  id: number;
  login: string;
  password_hash: string;
  role: UserRole;
  active: boolean;
  created_at: Date;
}

export interface Student {
  id: number;
  registration_number: string;
  name: string;
  course: string;
  period: string;
  person_code: string | null;
  sync_status: SyncStatus;
  created_at: Date;
  updated_at: Date;
}

export interface Employee {
  id: number;
  employee_code: string;
  name: string;
  department: string;
  email: string | null;
  sync_status: SyncStatus;
  created_at: Date;
  updated_at: Date;
}

export interface IdentifyResult {
  user: Student | Employee;
  user_type: UserType;
  photo: string | null;
  available_balance: number;
  daily_consumed: number;
  source_active: boolean;
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

export interface PrintOperation {
  id: number;
  operator_id: number;
  user_type: UserType;
  user_id: number;
  student_id: number | null; // legacy, kept during transition
  total_sheets: number;
  status: PrintOperationStatus;
  identify_method: 'manual' | 'rfid' | 'facial';
  created_at: Date;
}

export interface Entry {
  id: number;
  print_operation_id: number;
  user_type: UserType;
  user_id: number;
  student_id: number | null; // legacy
  sheets: number;
  type: EntryType;
  identify_method: 'manual' | 'rfid' | 'facial' | null;
  created_at: Date;
}

export interface Setting {
  key: string;
  value: string;
  description: string;
  updated_at: Date;
  updated_by: number | null;
}

export interface AuditLog {
  id: number;
  entry_id: number;
  operator_id: number;
  previous_value: number;
  new_value: number;
  reason: string;
  created_at: Date;
}

export interface JwtPayload {
  sub: number;
  login: string;
  role: UserRole;
}

export interface LyceumStudent {
  aluno: string;
  nome_compl: string;
  nome_social: string | null;
  nome_curso: string;
  nome_serie: string;
  pessoa: string;
}

export interface SituatorPerson {
  Id: number;
  Name: string;
  Document: string;
  PersonImage: string;
  Active: boolean;
  CardNumberHex: string;
}

export interface VectorAIResult {
  matricula: string | null;
  confidence: number;
  box: { top: number; right: number; bottom: number; left: number };
}
