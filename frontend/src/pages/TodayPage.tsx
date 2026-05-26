import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';
import { IdentifyResult, getUserIdentifier, getUserDetail } from '../types';
import { Spinner } from '../components/Spinner';
import { Modal } from '../components/Modal';
import { Search, Clock, Printer, TrendingUp, TrendingDown, Keyboard, CreditCard, Camera, Briefcase, AlertTriangle, FileX } from 'lucide-react';
import { SYNC_STATUS_LABELS } from '../lib/format';
import { useSSE } from '../hooks/useSSE';

const PAGE_SIZE = 10;
const MODAL_OPS_PAGE_SIZE = 5;

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function shortName(full: string): string {
  const parts = (full || '').trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]}` : parts[0];
}

interface TodayWasteItem {
  id: number;
  type: 'error' | 'blank';
  sheets: number;
  operator_login: string;
  created_at: string;
}

interface WasteToday {
  error_sheets: number;
  blank_sheets: number;
  events: TodayWasteItem[];
}

interface TodayUser {
  id: number;
  name: string;
  identifier: string;
  detail: string;
  user_type: 'student' | 'employee';
  quota_used: number;
  sheets_lent: number;
  total_printed: number;
  gave_loans: boolean;
  received_loans: boolean;
  last_operation_at: string;
  identify_method: 'manual' | 'rfid' | 'facial' | null;
}

const METHOD_ICON: Record<string, React.ReactNode> = {
  manual: <Keyboard size={10} />,
  rfid:   <CreditCard size={10} />,
  facial: <Camera size={10} />,
};
const METHOD_LABEL: Record<string, string> = {
  manual: 'Manual',
  rfid:   'Cartão',
  facial: 'Facial',
};
const METHOD_CLASS: Record<string, string> = {
  manual: 'bg-gray-100 text-gray-500',
  rfid:   'bg-blue-50 text-blue-600',
  facial: 'bg-purple-50 text-purple-600',
};

interface PrimaryEntry {
  id: number;
  user_id: number;
  user_type: string;
  sheets: number;
  type: 'own' | 'borrowed';
  user_name: string;
  user_identifier: string;
  user_detail?: string;
}

interface PrimaryOperation {
  id: number;
  total_sheets: number;
  status: string;
  created_at: string;
  operator_login: string;
  own_sheets: number;
  borrowed_sheets: number;
  entries: PrimaryEntry[];
}

interface LoanEntry {
  id: number;
  sheets: number;
  created_at: string;
  operation_id: number;
  operation_total: number;
  primary_user_id: number;
  primary_user_type: string;
  primary_user_name: string;
  primary_identifier: string;
  operator_login: string;
}

interface FullHistory {
  as_primary: PrimaryOperation[];
  as_lender: LoanEntry[];
}

type FilterType = 'all' | 'own' | 'borrowed';

export function TodayPage() {
  const [users, setUsers] = useState<TodayUser[]>([]);
  const [todayWaste, setTodayWaste] = useState<WasteToday>({ error_sheets: 0, blank_sheets: 0, events: [] });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [page, setPage] = useState(1);

  const [selectedUser, setSelectedUser] = useState<TodayUser | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [userDetail, setUserDetail] = useState<IdentifyResult | null>(null);
  const [fullHistory, setFullHistory] = useState<FullHistory | null>(null);
  const [modalOpsPage, setModalOpsPage] = useState(1);
  const todayDate = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();

  const fetchToday = useCallback(() => {
    Promise.all([
      api.get<TodayUser[]>('/students/today'),
      api.get<WasteToday>('/waste/today'),
    ]).then(([usersRes, wasteRes]) => {
      setUsers(usersRes.data);
      setTodayWaste(wasteRes.data);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    Promise.all([
      api.get<TodayUser[]>('/students/today'),
      api.get<WasteToday>('/waste/today'),
    ]).then(([usersRes, wasteRes]) => {
      setUsers(usersRes.data);
      setTodayWaste(wasteRes.data);
    }).finally(() => setLoading(false));

    const id = setInterval(fetchToday, 30_000);
    return () => clearInterval(id);
  }, [fetchToday]);

  useSSE('print_registered', fetchToday);

  useEffect(() => { setPage(1); }, [search, filter]);

  const openDetail = async (u: TodayUser) => {
    setSelectedUser(u);
    setDetailLoading(true);
    setUserDetail(null);
    setFullHistory(null);
    setModalOpsPage(1);
    try {
      let detailRes;
      if (u.user_type === 'employee') {
        detailRes = await api.post<IdentifyResult>('/employees/identify/manual', { employee_code: u.identifier });
      } else {
        detailRes = await api.post<IdentifyResult>('/students/identify/manual', { registration_number: u.identifier });
      }
      const histEndpoint = u.user_type === 'employee'
        ? `/employees/${u.id}/full-history`
        : `/students/${u.id}/full-history`;
      const histRes = await api.get<FullHistory>(histEndpoint, { params: { date: todayDate } });
      setUserDetail(detailRes.data);
      setFullHistory(histRes.data);
    } finally {
      setDetailLoading(false);
    }
  };

  const openDetailByEntry = (userId: number, userType: string, identifier: string, name: string) => {
    openDetail({
      id: userId,
      name,
      identifier,
      detail: '',
      user_type: userType as 'student' | 'employee',
      quota_used: 0,
      sheets_lent: 0,
      total_printed: 0,
      gave_loans: false,
      received_loans: false,
      last_operation_at: new Date().toISOString(),
      identify_method: null,
    });
  };

  const filtered = users.filter((u) => {
    const matchSearch =
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.identifier.includes(search);
    if (!matchSearch) return false;
    if (filter === 'own') return (u.quota_used - u.sheets_lent) > 0;
    if (filter === 'borrowed') return u.received_loans;
    return true;
  });

  const totalQuota = filtered.reduce((a, u) => a + u.quota_used, 0);
  const totalPrinted = filtered.reduce((a, u) => a + u.total_printed, 0);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const goToPage = (p: number) => setPage(Math.max(1, Math.min(p, totalPages)));

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[18px] font-semibold text-gray-900">Impressões de Hoje</h1>
          <p className="text-[13px] text-gray-500 mt-0.5">
            {users.length} usuário{users.length !== 1 ? 's' : ''} · {totalPrinted} folhas impressas · {totalQuota} de cota usada
            {(todayWaste.error_sheets + todayWaste.blank_sheets) > 0 && ` · ${todayWaste.error_sheets + todayWaste.blank_sheets} desperdiçadas`}
          </p>
        </div>
      </div>

      {/* Search + filter */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, matrícula ou código"
            className="w-full pl-9 pr-4 py-2.5 text-[14px] bg-white/70 backdrop-blur-sm border border-gray-200 rounded-xl outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-200"
          />
        </div>
        <div className="flex gap-1 p-1 bg-gray-100/80 rounded-xl shrink-0">
          {([
            { key: 'all', label: 'Todos' },
            { key: 'own', label: 'Próprias' },
            { key: 'borrowed', label: 'Empréstimos' },
          ] as const).map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${
                filter === f.key ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : (
        <div className="bg-white/70 backdrop-blur-xl border border-white/60 rounded-2xl shadow-glass overflow-hidden">
          {filtered.length === 0 && (filter !== 'all' || todayWaste.events.length === 0) ? (
            <p className="text-center text-[14px] text-gray-400 py-12">
              {search || filter !== 'all' ? 'Nenhum resultado.' : 'Nenhuma impressão registrada hoje.'}
            </p>
          ) : (
            <>
              {filtered.length > 0 && (
                <>
                  <div className="divide-y divide-gray-100/80">
                    {paginated.map((u, i) => (
                      <button
                        key={`${u.user_type}-${u.id}`}
                        onClick={() => openDetail(u)}
                        className="w-full flex items-center gap-3 px-4 py-2 hover:bg-gray-50/60 active:bg-gray-100/60 transition-colors text-left animate-fadeIn"
                        style={{ animationDelay: `${i * 20}ms` }}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            {u.user_type === 'employee' && (
                              <Briefcase size={11} className="shrink-0 text-blue-400" />
                            )}
                            <p className="text-[13px] font-medium text-gray-900 truncate">{u.name}</p>
                            {u.identify_method && (
                              <span className={`flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${METHOD_CLASS[u.identify_method] ?? 'bg-gray-100 text-gray-500'}`}>
                                {METHOD_ICON[u.identify_method]}
                                {METHOD_LABEL[u.identify_method]}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-gray-400 truncate">
                            {u.identifier}
                            {u.detail && ` · ${u.detail}`}
                          </p>
                        </div>

                        <div className="shrink-0 flex items-center gap-3">
                          <div className="flex items-center gap-1 text-[11px] text-gray-400">
                            <Clock size={10} />
                            {formatTime(u.last_operation_at)}
                          </div>
                          {(() => {
                            const received = u.total_printed - (u.quota_used - u.sheets_lent);
                            return (
                              <div className="text-right min-w-[44px]">
                                <p className="text-[14px] font-bold text-gray-900 leading-tight">{u.quota_used}</p>
                                <div className="flex items-center justify-end gap-1">
                                  <p className="text-[10px] text-gray-400 leading-none">folhas</p>
                                  {u.received_loans && received > 0 && (
                                    <span className="text-[10px] font-medium text-amber-500">↓{received}</span>
                                  )}
                                  {u.gave_loans && (
                                    <span className="text-[10px] font-medium text-emerald-600">↑{u.sheets_lent}</span>
                                  )}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      </button>
                    ))}
                  </div>

                  {/* Pagination */}
                  <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100/80 bg-gray-50/40">
                    <p className="text-[12px] text-gray-400">
                      {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} de {filtered.length}
                    </p>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => goToPage(safePage - 1)}
                        disabled={safePage === 1}
                        className="px-2.5 py-1.5 text-[12px] font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        Anterior
                      </button>
                      {Array.from({ length: totalPages }, (_, i) => i + 1)
                        .filter((p) => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1)
                        .reduce<(number | '...')[]>((acc, p, idx, arr) => {
                          if (idx > 0 && (p as number) - (arr[idx - 1] as number) > 1) acc.push('...');
                          acc.push(p);
                          return acc;
                        }, [])
                        .map((p, idx) =>
                          p === '...' ? (
                            <span key={`ellipsis-${idx}`} className="px-1.5 text-[12px] text-gray-400">…</span>
                          ) : (
                            <button
                              key={p}
                              onClick={() => goToPage(p as number)}
                              className={`w-8 h-8 text-[12px] font-medium rounded-lg transition-colors ${
                                p === safePage
                                  ? 'bg-gray-900 text-white'
                                  : 'border border-gray-200 text-gray-600 hover:bg-white'
                              }`}
                            >
                              {p}
                            </button>
                          )
                        )}
                      <button
                        onClick={() => goToPage(safePage + 1)}
                        disabled={safePage === totalPages}
                        className="px-2.5 py-1.5 text-[12px] font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        Próxima
                      </button>
                    </div>
                  </div>
                </>
              )}

              {/* Waste events — only in 'all' filter */}
              {filter === 'all' && todayWaste.events.length > 0 && (
                <>
                  <div className={`px-4 py-2 bg-gray-50/40 ${filtered.length > 0 ? 'border-t border-gray-100/80' : ''}`}>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Desperdício registrado</p>
                  </div>
                  <div className="divide-y divide-gray-100/80">
                    {todayWaste.events.map((e) => (
                      <div key={`waste-${e.id}`} className="flex items-center gap-3 px-4 py-2">
                        <div className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 ${e.type === 'error' ? 'bg-red-50 text-red-400' : 'bg-gray-100 text-gray-400'}`}>
                          {e.type === 'error' ? <AlertTriangle size={12} /> : <FileX size={12} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-gray-700">
                            {e.type === 'error' ? 'Erro de impressão' : 'Folhas em branco'}
                          </p>
                          <p className="text-[11px] text-gray-400">{e.operator_login} · {formatTime(e.created_at)}</p>
                        </div>
                        <div className="text-right min-w-[44px]">
                          <p className="text-[14px] font-bold text-gray-500 leading-tight">{e.sheets}</p>
                          <p className="text-[10px] text-gray-400 leading-none">folhas</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Detail modal */}
      <Modal
        open={!!selectedUser}
        onClose={() => setSelectedUser(null)}
        title={selectedUser?.user_type === 'employee' ? 'Detalhes do Funcionário' : 'Detalhes do Aluno'}
        size="xl"
      >
        {detailLoading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : userDetail && fullHistory ? (
          <div className="space-y-5">
            {/* Header with photo */}
            <div className="flex gap-4">
              <div className="shrink-0">
                {userDetail.photo ? (
                  <img
                    src={`data:image/jpeg;base64,${userDetail.photo}`}
                    alt={userDetail.user.name}
                    className="w-16 h-16 rounded-xl object-cover border border-white/60 shadow-sm"
                  />
                ) : userDetail.user_type === 'employee' ? (
                  <div className="w-16 h-16 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-400">
                    <Briefcase size={24} />
                  </div>
                ) : (
                  <div className="w-16 h-16 rounded-xl bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-400 text-xl font-semibold">
                    {userDetail.user.name.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-[15px] font-semibold text-gray-900">{userDetail.user.name}</p>
                  {userDetail.user_type === 'employee' && (
                    <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100">Funcionário</span>
                  )}
                </div>
                <p className="text-[12px] text-gray-500 mt-0.5">{getUserIdentifier(userDetail.user, userDetail.user_type)}</p>
                {(() => {
                  const detail = getUserDetail(userDetail.user, userDetail.user_type);
                  return detail ? <p className="text-[12px] text-gray-500">{detail}</p> : null;
                })()}
                {userDetail.user.sync_status !== 'synced' && (
                  <span className="inline-block mt-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                    {SYNC_STATUS_LABELS[userDetail.user.sync_status]}
                  </span>
                )}
              </div>
            </div>

            {/* Quota summary */}
            {(() => {
              const totalPrintedToday = fullHistory.as_primary.reduce((a, op) => a + op.total_sheets, 0);
              const ownSheetsTotal = fullHistory.as_primary.reduce((a, op) => a + op.own_sheets, 0);
              const receivedTotal = fullHistory.as_primary.reduce((a, op) => a + op.borrowed_sheets, 0);
              const lentTotal = fullHistory.as_lender.reduce((a, e) => a + e.sheets, 0);

              return (
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { label: 'Total impresso', value: totalPrintedToday, icon: <Printer size={13} />, color: 'text-gray-700' },
                    { label: 'Cota própria', value: ownSheetsTotal, icon: <Clock size={13} />, color: 'text-blue-600' },
                    { label: 'Empréstimo recebido', value: receivedTotal, icon: <TrendingDown size={13} />, color: 'text-amber-600' },
                    { label: 'Cota cedida', value: lentTotal, icon: <TrendingUp size={13} />, color: 'text-emerald-600' },
                  ].map((item) => (
                    <div key={item.label} className="flex flex-col items-center p-3 bg-gray-50/80 rounded-xl border border-gray-100">
                      <span className={`${item.color} mb-1`}>{item.icon}</span>
                      <p className={`text-[18px] font-bold ${item.color}`}>{item.value}</p>
                      <p className="text-[10px] text-gray-500 text-center leading-tight mt-0.5">{item.label}</p>
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* Operations as primary */}
            {fullHistory.as_primary.length > 0 && (() => {
              const totalOpsPages = Math.max(1, Math.ceil(fullHistory.as_primary.length / MODAL_OPS_PAGE_SIZE));
              const safeOpsPage = Math.min(modalOpsPage, totalOpsPages);
              const pagedOps = fullHistory.as_primary.slice((safeOpsPage - 1) * MODAL_OPS_PAGE_SIZE, safeOpsPage * MODAL_OPS_PAGE_SIZE);
              return (
                <div>
                  <p className="text-[12px] font-medium text-gray-500 uppercase tracking-wide mb-2">
                    Operações realizadas hoje
                  </p>
                  <div className="space-y-2">
                    {pagedOps.map((op) => (
                      <div key={op.id} className="rounded-xl border border-gray-100 overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-2 bg-gray-50/70 border-b border-gray-100">
                          <span className="text-[12px] text-gray-500">
                            Op. #{op.id} · {formatTime(op.created_at)} · {op.operator_login}
                          </span>
                          <span className="text-[13px] font-bold text-gray-900">{op.total_sheets} folhas</span>
                        </div>
                        {op.entries.map((e) => {
                          const isOwn = e.user_id === selectedUser?.id && e.user_type === selectedUser?.user_type;
                          const displayName = shortName(e.user_name ?? '');
                          return (
                            <div key={e.id} className="flex items-center justify-between px-4 py-2.5 bg-white/60">
                              <div className="flex items-center gap-2">
                                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${
                                  isOwn ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'
                                }`}>
                                  {isOwn ? 'Própria' : 'Empréstimo'}
                                </span>
                                {!isOwn && (
                                  <button
                                    onClick={(ev) => { ev.stopPropagation(); openDetailByEntry(e.user_id, e.user_type, e.user_identifier, e.user_name); }}
                                    className="min-w-0 text-left group"
                                  >
                                    <p className="text-[12px] font-medium text-gray-800 leading-tight group-hover:text-blue-600 transition-colors">{displayName}</p>
                                    <p className="text-[10px] text-gray-400 leading-tight truncate">{e.user_identifier}</p>
                                  </button>
                                )}
                              </div>
                              <span className="text-[13px] font-semibold text-gray-900 shrink-0">{e.sheets} folhas</span>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                  {totalOpsPages > 1 && (
                    <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-100">
                      <p className="text-[11px] text-gray-400">
                        {(safeOpsPage - 1) * MODAL_OPS_PAGE_SIZE + 1}–{Math.min(safeOpsPage * MODAL_OPS_PAGE_SIZE, fullHistory.as_primary.length)} de {fullHistory.as_primary.length}
                      </p>
                      <div className="flex gap-1">
                        <button
                          onClick={() => setModalOpsPage(Math.max(1, safeOpsPage - 1))}
                          disabled={safeOpsPage === 1}
                          className="px-2 py-1 text-[11px] font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          Anterior
                        </button>
                        <button
                          onClick={() => setModalOpsPage(Math.min(totalOpsPages, safeOpsPage + 1))}
                          disabled={safeOpsPage === totalOpsPages}
                          className="px-2 py-1 text-[11px] font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          Próxima
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Loans given */}
            {fullHistory.as_lender.length > 0 && (
              <div>
                <p className="text-[12px] font-medium text-gray-500 uppercase tracking-wide mb-2">
                  Cota cedida a outros usuários
                </p>
                <div className="rounded-xl border border-gray-100 overflow-hidden divide-y divide-gray-100">
                  {fullHistory.as_lender.map((e) => (
                    <div key={e.id} className="flex items-center justify-between px-4 py-2.5 bg-white/60">
                      <button
                        onClick={() => openDetailByEntry(e.primary_user_id, e.primary_user_type, e.primary_identifier, e.primary_user_name)}
                        className="text-left group"
                      >
                        <p className="text-[13px] font-medium text-gray-900 group-hover:text-blue-600 transition-colors">{e.primary_user_name}</p>
                        <p className="text-[11px] text-gray-400">{e.primary_identifier} · op. #{e.operation_id}</p>
                      </button>
                      <span className="text-[13px] font-bold text-emerald-700">{e.sheets} folhas</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
