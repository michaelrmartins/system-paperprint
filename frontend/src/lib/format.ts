export function formatDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(d);
}

export function formatDateOnly(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(iso));
}

export const ROLE_LABELS: Record<string, string> = {
  operator: 'Operador',
  auditor: 'Auditor',
  admin: 'Administrador',
};

export const ENTRY_TYPE_LABELS: Record<string, string> = {
  own: 'Própria',
  borrowed: 'Empréstimo',
};

export const STATUS_LABELS: Record<string, string> = {
  completed: 'Concluída',
  contingency: 'Contingência',
  attention: 'Atenção',
};

export const SYNC_STATUS_LABELS: Record<string, string> = {
  synced: 'Sincronizado',
  pending: 'Pendente',
  attention: 'Atenção',
};

export const SETTING_LABELS: Record<string, string> = {
  daily_quota: 'Cota diária (folhas)',
  max_stacked_registrations: 'Máx. matrículas empilhadas',
  duplex_counts_double: 'Duplex conta como 2 folhas',
  quota_reset_time: 'Horário de reset da cota',
};
