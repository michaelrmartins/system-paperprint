export type UserRole = 'operator' | 'auditor' | 'admin';

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
  sync_status: 'synced' | 'pending' | 'attention';
  created_at: Date;
  updated_at: Date;
}

export type PrintOperationStatus = 'completed' | 'contingency' | 'attention';

export interface PrintOperation {
  id: number;
  operator_id: number;
  student_id: number;
  total_sheets: number;
  status: PrintOperationStatus;
  created_at: Date;
}

export type EntryType = 'own' | 'borrowed';

export interface Entry {
  id: number;
  print_operation_id: number;
  student_id: number;
  sheets: number;
  type: EntryType;
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
  matricula: string;
  confidence: number;
  box: { top: number; right: number; bottom: number; left: number };
}

export interface StackedDebit {
  registration_number: string;
  student_id: number;
  name: string;
  available: number;
  sheets_to_debit: number;
  identify_method?: 'manual' | 'rfid' | 'facial';
}
