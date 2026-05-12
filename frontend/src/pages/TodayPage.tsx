import { useState, useEffect } from 'react';
import api from '../lib/api';
import { Spinner } from '../components/Spinner';
import { Modal } from '../components/Modal';
import { Search, Clock, Printer, TrendingUp, TrendingDown, Keyboard, CreditCard, Camera } from 'lucide-react';
import { SYNC_STATUS_LABELS } from '../lib/format';

const PAGE_SIZE = 10;

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

interface TodayStudent {
  id: number;
  registration_number: string;
  name: string;
  course: string;
  period: string;
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
  student_id: number;
  sheets: number;
  type: 'own' | 'borrowed';
  student_name: string;
  registration_number: string;
  course?: string;
  period?: string;
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
  primary_student_id: number;
  primary_student_name: string;
  primary_registration: string;
  operator_login: string;
}

interface FullHistory {
  as_primary: PrimaryOperation[];
  as_lender: LoanEntry[];
}

interface IdentifyResult {
  student: TodayStudent & { sync_status: string; person_code: string | null };
  photo: string | null;
  available_balance: number;
  daily_consumed: number;
}

type FilterType = 'all' | 'own' | 'borrowed';

export function TodayPage() {
  const [students, setStudents] = useState<TodayStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [page, setPage] = useState(1);

  const [selectedStudent, setSelectedStudent] = useState<TodayStudent | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [studentDetail, setStudentDetail] = useState<IdentifyResult | null>(null);
  const [fullHistory, setFullHistory] = useState<FullHistory | null>(null);
  const todayDate = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();

  useEffect(() => {
    api.get<TodayStudent[]>('/students/today')
      .then((r) => setStudents(r.data))
      .finally(() => setLoading(false));

    const id = setInterval(() => {
      api.get<TodayStudent[]>('/students/today').then((r) => setStudents(r.data)).catch(() => {});
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => { setPage(1); }, [search, filter]);

  const openDetail = async (s: TodayStudent) => {
    setSelectedStudent(s);
    setDetailLoading(true);
    setStudentDetail(null);
    setFullHistory(null);
    try {
      const [detailRes, histRes] = await Promise.all([
        api.post<IdentifyResult>('/students/identify/manual', { registration_number: s.registration_number }),
        api.get<FullHistory>(`/students/${s.id}/full-history`, { params: { date: todayDate } }),
      ]);
      setStudentDetail(detailRes.data);
      setFullHistory(histRes.data);
    } finally {
      setDetailLoading(false);
    }
  };

  const openDetailByEntry = (studentId: number, registrationNumber: string, name: string) => {
    openDetail({
      id: studentId,
      registration_number: registrationNumber,
      name,
      course: '',
      period: '',
      quota_used: 0,
      sheets_lent: 0,
      total_printed: 0,
      gave_loans: false,
      received_loans: false,
      last_operation_at: new Date().toISOString(),
      identify_method: null,
    });
  };

  const filtered = students.filter((s) => {
    const matchSearch =
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.registration_number.includes(search);
    if (!matchSearch) return false;
    if (filter === 'own') return (s.quota_used - s.sheets_lent) > 0;
    if (filter === 'borrowed') return s.received_loans;
    return true;
  });

  const totalQuota = filtered.reduce((a, s) => a + s.quota_used, 0);
  const totalPrinted = filtered.reduce((a, s) => a + s.total_printed, 0);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const goToPage = (p: number) => setPage(Math.max(1, Math.min(p, totalPages)));

  // Reset to page 1 when search or filter changes — handled inline via safePage

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[18px] font-semibold text-gray-900">Impressões de Hoje</h1>
          <p className="text-[13px] text-gray-500 mt-0.5">
            {students.length} aluno{students.length !== 1 ? 's' : ''} · {totalPrinted} folhas impressas · {totalQuota} de cota usada
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
            placeholder="Buscar por nome ou matrícula"
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
          {filtered.length === 0 ? (
            <p className="text-center text-[14px] text-gray-400 py-12">
              {search || filter !== 'all' ? 'Nenhum resultado.' : 'Nenhuma impressão registrada hoje.'}
            </p>
          ) : (
            <>
              <div className="divide-y divide-gray-100/80">
                {paginated.map((s, i) => (
                  <button
                    key={s.id}
                    onClick={() => openDetail(s)}
                    className="w-full flex items-center gap-3 px-4 py-2 hover:bg-gray-50/60 active:bg-gray-100/60 transition-colors text-left animate-fadeIn"
                    style={{ animationDelay: `${i * 20}ms` }}
                  >
                    {/* Student info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-[13px] font-medium text-gray-900 truncate">{s.name}</p>
                        {s.identify_method && (
                          <span className={`flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${METHOD_CLASS[s.identify_method] ?? 'bg-gray-100 text-gray-500'}`}>
                            {METHOD_ICON[s.identify_method]}
                            {METHOD_LABEL[s.identify_method]}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-gray-400 truncate">
                        {s.registration_number}
                        {s.course && ` · ${s.course}`}
                        {s.period && ` · ${s.period}`}
                      </p>
                    </div>

                    {/* Time + Stats */}
                    <div className="shrink-0 flex items-center gap-3">
                      <div className="flex items-center gap-1 text-[11px] text-gray-400">
                        <Clock size={10} />
                        {formatTime(s.last_operation_at)}
                      </div>
                      {(() => {
                        const received = s.total_printed - (s.quota_used - s.sheets_lent);
                        return (
                          <div className="text-right min-w-[44px]">
                            <p className="text-[14px] font-bold text-gray-900 leading-tight">{s.quota_used}</p>
                            <div className="flex items-center justify-end gap-1">
                              <p className="text-[10px] text-gray-400 leading-none">folhas</p>
                              {s.received_loans && received > 0 && (
                                <span className="text-[10px] font-medium text-amber-500">↓{received}</span>
                              )}
                              {s.gave_loans && (
                                <span className="text-[10px] font-medium text-emerald-600">↑{s.sheets_lent}</span>
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
              {filtered.length > 0 && (
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
              )}
            </>
          )}
        </div>
      )}

      {/* Student detail modal */}
      <Modal
        open={!!selectedStudent}
        onClose={() => setSelectedStudent(null)}
        title="Detalhes do Aluno"
        size="xl"
      >
        {detailLoading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : studentDetail && fullHistory ? (
          <div className="space-y-5">
            {/* Header with photo */}
            <div className="flex gap-4">
              <div className="shrink-0">
                {studentDetail.photo ? (
                  <img
                    src={`data:image/jpeg;base64,${studentDetail.photo}`}
                    alt={studentDetail.student.name}
                    className="w-16 h-16 rounded-xl object-cover border border-white/60 shadow-sm"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-xl bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-400 text-xl font-semibold">
                    {studentDetail.student.name.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-semibold text-gray-900">{studentDetail.student.name}</p>
                <p className="text-[12px] text-gray-500 mt-0.5">{studentDetail.student.registration_number}</p>
                {studentDetail.student.course && (
                  <p className="text-[12px] text-gray-500">
                    {studentDetail.student.course}
                    {studentDetail.student.period && ` · ${studentDetail.student.period}`}
                  </p>
                )}
                {studentDetail.student.sync_status !== 'synced' && (
                  <span className="inline-block mt-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                    {SYNC_STATUS_LABELS[studentDetail.student.sync_status]}
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
            {fullHistory.as_primary.length > 0 && (
              <div>
                <p className="text-[12px] font-medium text-gray-500 uppercase tracking-wide mb-2">
                  Operações realizadas hoje
                </p>
                <div className="space-y-2">
                  {fullHistory.as_primary.map((op) => (
                    <div key={op.id} className="rounded-xl border border-gray-100 overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-2 bg-gray-50/70 border-b border-gray-100">
                        <span className="text-[12px] text-gray-500">
                          Op. #{op.id} · {formatTime(op.created_at)} · {op.operator_login}
                        </span>
                        <span className="text-[13px] font-bold text-gray-900">{op.total_sheets} folhas</span>
                      </div>
                      {op.entries.map((e) => {
                        const parts = e.student_name.trim().split(/\s+/);
                        const displayName = parts.length > 1
                          ? `${parts[0]} ${parts[parts.length - 1]}`
                          : parts[0];
                        return (
                          <div key={e.id} className="flex items-center justify-between px-4 py-2.5 bg-white/60">
                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${
                                e.student_id === selectedStudent?.id
                                  ? 'bg-blue-50 text-blue-700'
                                  : 'bg-amber-50 text-amber-700'
                              }`}>
                                {e.student_id === selectedStudent?.id ? 'Própria' : 'Empréstimo'}
                              </span>
                              {e.student_id !== selectedStudent?.id && (
                                <button
                                  onClick={(ev) => { ev.stopPropagation(); openDetailByEntry(e.student_id, e.registration_number, e.student_name); }}
                                  className="min-w-0 text-left group"
                                >
                                  <p className="text-[12px] font-medium text-gray-800 leading-tight group-hover:text-blue-600 transition-colors">{displayName}</p>
                                  <p className="text-[10px] text-gray-400 leading-tight truncate">
                                    {e.registration_number}
                                    {e.course ? ` · ${e.course}` : ''}
                                    {e.period ? ` · ${e.period}` : ''}
                                  </p>
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
              </div>
            )}

            {/* Loans given */}
            {fullHistory.as_lender.length > 0 && (
              <div>
                <p className="text-[12px] font-medium text-gray-500 uppercase tracking-wide mb-2">
                  Cota cedida a outros alunos
                </p>
                <div className="rounded-xl border border-gray-100 overflow-hidden divide-y divide-gray-100">
                  {fullHistory.as_lender.map((e) => (
                    <div key={e.id} className="flex items-center justify-between px-4 py-2.5 bg-white/60">
                      <button
                        onClick={() => openDetailByEntry(e.primary_student_id, e.primary_registration, e.primary_student_name)}
                        className="text-left group"
                      >
                        <p className="text-[13px] font-medium text-gray-900 group-hover:text-blue-600 transition-colors">{e.primary_student_name}</p>
                        <p className="text-[11px] text-gray-400">{e.primary_registration} · op. #{e.operation_id}</p>
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
