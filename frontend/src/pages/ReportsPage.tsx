import { useState, useEffect } from 'react';
import ReactECharts from 'echarts-for-react';
import api from '../lib/api';
import { Spinner } from '../components/Spinner';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Modal } from '../components/Modal';
import { formatDate, ENTRY_TYPE_LABELS } from '../lib/format';
import { AuditEntry } from '../types';
import { Search, ChevronRight, ChevronDown } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────
type ReportTab = 'course' | 'period' | 'top' | 'monthly' | 'hours' | 'operator' | 'loan-type' | 'identify-method' | 'history' | 'audit';

interface CourseRow    { course: string; total_sheets: string }
interface PeriodRow    { period: string; total_sheets: string }
interface TopRow       { id: number; name: string; registration_number: string; course: string; period: string; total_sheets: string }
interface MonthlyRow   { month: number; total_sheets: string; total_operations: string }
interface HourRow      { hour: number; total_operations: number; total_sheets: number }
interface OperatorRow  { operator: string; total_operations: string; total_sheets: string }
interface LoanTypeRow        { type: 'own' | 'borrowed'; total_sheets: string; total_operations: string }
interface IdentifyMethodRow  { identify_method: 'manual' | 'rfid' | 'facial'; total_operations: string; total_sheets: string }

const METHOD_LABEL: Record<string, string> = {
  manual: 'Manual (Matrícula)',
  rfid:   'Carteirinha (RFID)',
  facial: 'Reconhecimento Facial',
};
interface PeriodStudent { id: number; name: string; registration_number: string; total_sheets: string }
interface HistoryEntry {
  id: number; sheets: number; type: 'own' | 'borrowed'; created_at: string;
  operation_id: number; status: string; total_sheets: number; operator_login: string;
}

const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const TYPE_LABEL: Record<string, string> = { own: 'Impressões próprias', borrowed: 'Cotas emprestadas' };

// ─── Chart factories ──────────────────────────────────────────────────────────
function hBar(categories: string[], values: number[], name = 'Folhas') {
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 6, right: 20, top: 6, bottom: 6, containLabel: true },
    xAxis: { type: 'value', splitLine: { lineStyle: { color: '#f5f5f7', type: 'dashed' as const } }, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { fontSize: 10, color: '#8e8e93' } },
    yAxis: { type: 'category', data: categories, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { fontSize: 11, color: '#3a3a3c', overflow: 'truncate' as const, width: 120 } },
    series: [{ name, type: 'bar', data: values, itemStyle: { color: '#1c1c1e', borderRadius: [0, 3, 3, 0] }, barMaxWidth: 18 }],
  };
}

function vBar(categories: string[], values: number[], name = 'Total', color = '#1c1c1e') {
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' as const } },
    grid: { left: 8, right: 8, top: 10, bottom: 8, containLabel: true },
    xAxis: { type: 'category', data: categories, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { fontSize: 10, color: '#636366' } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: '#f5f5f7', type: 'dashed' as const } }, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { fontSize: 10, color: '#8e8e93' } },
    series: [{ name, type: 'bar', data: values, itemStyle: { color, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 28 }],
  };
}

function pie(data: { name: string; value: number }[]) {
  return {
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { bottom: '2%', itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 11, color: '#48484a' } },
    color: ['#1c1c1e', '#636366', '#aeaeb2', '#d1d1d6', '#e5e5ea'],
    series: [{
      type: 'pie', radius: ['38%', '65%'], center: ['50%', '44%'], data,
      label: { fontSize: 10, formatter: '{d}%' },
      itemStyle: { borderWidth: 2, borderColor: '#ffffff' },
    }],
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function Avatar({ photo, name, size = 'sm' }: { photo?: string | null; name: string; size?: 'sm' | 'md' }) {
  const base = size === 'sm' ? 'w-8 h-8 rounded-lg text-[11px]' : 'w-12 h-12 rounded-xl text-[15px]';
  if (photo) return <img src={`data:image/jpeg;base64,${photo}`} alt={name} className={`${base} object-cover border border-white/60 shadow-sm shrink-0`} />;
  return <div className={`${base} bg-gray-100 border border-gray-200 flex items-center justify-center font-semibold text-gray-500 shrink-0`}>{name.charAt(0).toUpperCase()}</div>;
}

function LazyAvatar({ studentId, name }: { studentId: number; name: string }) {
  const [photo, setPhoto] = useState<string | null>(null);
  useEffect(() => {
    api.get<{ photo: string | null }>(`/students/${studentId}/photo`).then(r => setPhoto(r.data.photo)).catch(() => {});
  }, [studentId]);
  return <Avatar photo={photo} name={name} size="sm" />;
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-white/70 backdrop-blur-xl border border-white/60 rounded-2xl shadow-glass p-4">{children}</div>;
}

function TableWrap({ children }: { children: React.ReactNode }) {
  return <div className="bg-white/70 backdrop-blur-xl border border-white/60 rounded-2xl shadow-glass overflow-hidden">{children}</div>;
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`${right ? 'text-right' : 'text-left'} px-5 py-3 font-medium text-gray-500 text-[13px]`}>{children}</th>;
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export function ReportsPage() {
  const [tab, setTab] = useState<ReportTab>('course');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<unknown[]>([]);
  const [start, setStart] = useState('');
  const [end, setEnd]     = useState('');
  const [year, setYear]   = useState(String(new Date().getFullYear()));

  // Period expansion
  const [expandedPeriods, setExpandedPeriods]         = useState<Set<string>>(new Set());
  const [periodStudents, setPeriodStudents]           = useState<Record<string, PeriodStudent[]>>({});
  const [periodStudentsLoading, setPeriodStudentsLoading] = useState<Record<string, boolean>>({});

  // Top student modal
  const [selectedTop, setSelectedTop]   = useState<TopRow | null>(null);
  const [topPhoto, setTopPhoto]         = useState<string | null>(null);
  const [topHistory, setTopHistory]     = useState<HistoryEntry[]>([]);
  const [topModalLoading, setTopModalLoading] = useState(false);

  // History tab
  const [histReg, setHistReg]           = useState('');
  const [histStudentId, setHistStudentId] = useState<number | null>(null);
  const [histSearching, setHistSearching] = useState(false);
  const [histError, setHistError]       = useState('');
  const [histData, setHistData]         = useState<HistoryEntry[]>([]);
  const [histDate, setHistDate]         = useState('');

  const load = async () => {
    if (tab === 'history') return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (tab === 'monthly') { params.set('year', year); }
      else { if (start) params.set('start', start); if (end) params.set('end', end); }

      const ep: Record<string, string> = {
        course: '/reports/by-course', period: '/reports/by-period',
        top: '/reports/top-students', monthly: '/reports/monthly',
        hours: '/reports/by-hour', operator: '/reports/by-operator',
        'loan-type': '/reports/own-vs-borrowed', 'identify-method': '/reports/by-identify-method',
      audit: '/reports/audit',
      };
      const res = await api.get<unknown[]>(`${ep[tab]}?${params}`);
      setData(res.data);
      setExpandedPeriods(new Set());
      setPeriodStudents({});
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setData([]);
    setExpandedPeriods(new Set());
    setPeriodStudents({});
    if (tab !== 'history') load();
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const togglePeriod = async (period: string) => {
    const next = new Set(expandedPeriods);
    if (next.has(period)) { next.delete(period); }
    else {
      next.add(period);
      if (!periodStudents[period]) {
        setPeriodStudentsLoading(p => ({ ...p, [period]: true }));
        try {
          const params = new URLSearchParams({ period });
          if (start) params.set('start', start);
          if (end) params.set('end', end);
          const res = await api.get<PeriodStudent[]>(`/reports/period-students?${params}`);
          setPeriodStudents(p => ({ ...p, [period]: res.data }));
        } finally {
          setPeriodStudentsLoading(p => ({ ...p, [period]: false }));
        }
      }
    }
    setExpandedPeriods(next);
  };

  const openTopModal = async (student: TopRow) => {
    setSelectedTop(student);
    setTopModalLoading(true);
    setTopHistory([]);
    setTopPhoto(null);
    try {
      const [histRes, photoRes] = await Promise.all([
        api.get<HistoryEntry[]>(`/students/${student.id}/history`),
        api.get<{ photo: string | null }>(`/students/${student.id}/photo`).catch(() => ({ data: { photo: null } })),
      ]);
      setTopHistory(histRes.data);
      setTopPhoto(photoRes.data.photo);
    } finally {
      setTopModalLoading(false);
    }
  };

  const searchHistory = async () => {
    if (!histReg.trim()) return;
    setHistSearching(true); setHistError(''); setHistData([]);
    try {
      const idRes = await api.post<{ student: { id: number } }>('/students/identify/manual', { registration_number: histReg.trim() });
      const sid = idRes.data.student.id;
      setHistStudentId(sid);
      const params = new URLSearchParams();
      if (histDate) params.set('date', histDate);
      const hRes = await api.get<HistoryEntry[]>(`/students/${sid}/history?${params}`);
      setHistData(hRes.data);
    } catch { setHistError('Aluno não encontrado.'); }
    finally { setHistSearching(false); }
  };

  const tabs: { key: ReportTab; label: string }[] = [
    { key: 'course',     label: 'Por Curso' },
    { key: 'period',     label: 'Por Período' },
    { key: 'top',        label: 'Top Alunos' },
    { key: 'monthly',    label: 'Mensal' },
    { key: 'hours',      label: 'Horários de Pico' },
    { key: 'operator',   label: 'Por Operador' },
    { key: 'loan-type',       label: 'Próprias vs Emp.' },
    { key: 'identify-method', label: 'Identificação' },
    { key: 'history',         label: 'Histórico' },
    { key: 'audit',      label: 'Auditoria' },
  ];

  const noData = !loading && data.length === 0 && tab !== 'history' && tab !== 'hours';

  return (
    <div className="space-y-4">
      <h1 className="text-[18px] font-semibold text-gray-900">Relatórios</h1>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-gray-100/80 rounded-xl overflow-x-auto">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`shrink-0 px-3 py-2 rounded-lg text-[12px] font-medium transition-all ${tab === t.key ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      {tab !== 'history' && (
        <div className="flex gap-2 items-end flex-wrap">
          {tab === 'monthly' ? (
            <input type="number" value={year} onChange={e => setYear(e.target.value)}
              className="w-24 px-3 py-2 text-[13px] border border-gray-200 rounded-xl outline-none focus:border-gray-400" placeholder="Ano" />
          ) : (
            <>
              <input type="date" value={start} onChange={e => setStart(e.target.value)}
                className="px-3 py-2 text-[13px] border border-gray-200 rounded-xl outline-none focus:border-gray-400" />
              <input type="date" value={end} onChange={e => setEnd(e.target.value)}
                className="px-3 py-2 text-[13px] border border-gray-200 rounded-xl outline-none focus:border-gray-400" />
            </>
          )}
          <Button onClick={load} loading={loading} size="sm" variant="secondary">Filtrar</Button>
        </div>
      )}

      {loading && <div className="flex justify-center py-12"><Spinner /></div>}
      {noData && <p className="text-center text-[14px] text-gray-400 py-12">Sem dados para o período.</p>}

      {/* ── History ── */}
      {tab === 'history' && (
        <div className="space-y-4">
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Input label="Matrícula" value={histReg} onChange={e => setHistReg(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && searchHistory()} placeholder="Digite a matrícula" />
            </div>
            <input type="date" value={histDate} onChange={e => setHistDate(e.target.value)}
              className="px-3 py-2 text-[13px] border border-gray-200 rounded-xl outline-none focus:border-gray-400 self-end" />
            <Button onClick={searchHistory} loading={histSearching} size="sm" variant="secondary" className="self-end">
              <Search size={14} /> Buscar
            </Button>
          </div>
          {histError && <p className="text-[13px] text-red-500">{histError}</p>}
          {histData.length > 0 && (
            <TableWrap>
              <table className="w-full text-[13px]">
                <thead className="bg-gray-50/80 border-b border-gray-100"><tr><Th>Data</Th><Th>Tipo</Th><Th>Operação</Th><Th right>Folhas</Th></tr></thead>
                <tbody className="divide-y divide-gray-100/80">
                  {histData.map(e => (
                    <tr key={e.id} className="hover:bg-gray-50/40">
                      <td className="px-5 py-3 text-gray-600">{formatDate(e.created_at)}</td>
                      <td className="px-5 py-3"><span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${e.type === 'own' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>{ENTRY_TYPE_LABELS[e.type]}</span></td>
                      <td className="px-5 py-3 text-gray-500">#{e.operation_id} · {e.operator_login}</td>
                      <td className="px-5 py-3 text-right font-bold text-gray-900">{e.sheets}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-gray-200 bg-gray-50/60">
                  <tr>
                    <td colSpan={3} className="px-5 py-3 text-[13px] text-gray-500">
                      Próprias: <strong>{histData.filter(e => e.type === 'own').reduce((a, e) => a + e.sheets, 0)}</strong>
                      {' · '}Empréstimos: <strong>{histData.filter(e => e.type === 'borrowed').reduce((a, e) => a + e.sheets, 0)}</strong>
                    </td>
                    <td className="px-5 py-3 text-right font-bold">{histData.reduce((a, e) => a + e.sheets, 0)}</td>
                  </tr>
                </tfoot>
              </table>
            </TableWrap>
          )}
          {!histSearching && histData.length === 0 && histStudentId !== null && (
            <p className="text-center text-[14px] text-gray-400 py-8">Nenhuma impressão encontrada.</p>
          )}
        </div>
      )}

      {/* ── Course ── */}
      {!loading && tab === 'course' && data.length > 0 && (() => {
        const rows = data as CourseRow[];
        const rev = [...rows].reverse();
        return (
          <div className="space-y-4">
            <Card>
              <ReactECharts option={hBar(rev.map(r => r.course || '—'), rev.map(r => parseInt(r.total_sheets)))}
                style={{ height: `${Math.max(200, rows.length * 32)}px` }} opts={{ renderer: 'svg' }} />
            </Card>
            <TableWrap>
              <table className="w-full text-[13px]">
                <thead className="bg-gray-50/80 border-b border-gray-100"><tr><Th>Curso</Th><Th right>Folhas</Th></tr></thead>
                <tbody className="divide-y divide-gray-100/80">
                  {rows.map(r => (
                    <tr key={r.course} className="hover:bg-gray-50/40">
                      <td className="px-5 py-3 text-gray-800">{r.course || '—'}</td>
                      <td className="px-5 py-3 text-right font-semibold">{r.total_sheets}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </div>
        );
      })()}

      {/* ── Period ── */}
      {!loading && tab === 'period' && data.length > 0 && (() => {
        const rows = data as PeriodRow[];
        const rev = [...rows].reverse();
        return (
          <div className="space-y-4">
            <Card>
              <ReactECharts option={hBar(rev.map(r => r.period || '—'), rev.map(r => parseInt(r.total_sheets)))}
                style={{ height: `${Math.max(180, rows.length * 36)}px` }} opts={{ renderer: 'svg' }} />
            </Card>
            <TableWrap>
              {rows.map(r => {
                const isOpen = expandedPeriods.has(r.period);
                const students = periodStudents[r.period] ?? [];
                const loadingSt = periodStudentsLoading[r.period];
                return (
                  <div key={r.period} className="border-b border-gray-100/80 last:border-0">
                    <button onClick={() => togglePeriod(r.period)}
                      className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50/50 transition-colors text-left">
                      <div className="flex items-center gap-2">
                        {isOpen ? <ChevronDown size={14} className="text-gray-400 shrink-0" /> : <ChevronRight size={14} className="text-gray-400 shrink-0" />}
                        <span className="text-[14px] font-medium text-gray-900">{r.period || '—'}</span>
                      </div>
                      <span className="text-[14px] font-bold text-gray-900">{r.total_sheets} folhas</span>
                    </button>
                    {isOpen && (
                      <div className="px-5 pb-3 bg-gray-50/40">
                        {loadingSt ? (
                          <div className="flex items-center gap-2 py-3 text-[13px] text-gray-400"><Spinner size="sm" /> Carregando...</div>
                        ) : students.length === 0 ? (
                          <p className="text-[13px] text-gray-400 py-2">Nenhum aluno encontrado.</p>
                        ) : (
                          <div className="space-y-1 pt-1">
                            {students.map(s => (
                              <div key={s.id} className="flex items-center gap-3 py-1.5 px-2 rounded-xl hover:bg-white/60 transition-colors">
                                <LazyAvatar studentId={s.id} name={s.name} />
                                <div className="flex-1 min-w-0">
                                  <p className="text-[13px] font-medium text-gray-900 truncate">{s.name}</p>
                                  <p className="text-[11px] text-gray-400">{s.registration_number}</p>
                                </div>
                                <span className="text-[13px] font-bold text-gray-700 shrink-0">{s.total_sheets} folhas</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </TableWrap>
          </div>
        );
      })()}

      {/* ── Top Students ── */}
      {!loading && tab === 'top' && data.length > 0 && (() => {
        const rows = data as TopRow[];
        const top10 = rows.slice(0, 10);
        const rev = [...top10].reverse();
        return (
          <div className="space-y-4">
            <Card>
              <ReactECharts option={hBar(rev.map(r => r.name), rev.map(r => parseInt(r.total_sheets)))}
                style={{ height: `${Math.max(200, top10.length * 32)}px` }} opts={{ renderer: 'svg' }} />
            </Card>
            <TableWrap>
              <table className="w-full text-[13px]">
                <thead className="bg-gray-50/80 border-b border-gray-100"><tr><Th>#</Th><Th>Aluno</Th><Th right>Folhas</Th></tr></thead>
                <tbody className="divide-y divide-gray-100/80">
                  {rows.map((r, i) => (
                    <tr key={r.id} onClick={() => openTopModal(r)}
                      className="hover:bg-gray-50/60 cursor-pointer active:bg-gray-100/60 transition-colors">
                      <td className="px-5 py-3 text-gray-400 font-medium w-10">{i + 1}</td>
                      <td className="px-5 py-3">
                        <p className="font-medium text-gray-900">{r.name}</p>
                        <p className="text-[11px] text-gray-400">{r.registration_number} · {r.course}</p>
                      </td>
                      <td className="px-5 py-3 text-right font-bold text-gray-900">{r.total_sheets}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </div>
        );
      })()}

      {/* ── Monthly ── */}
      {!loading && tab === 'monthly' && data.length > 0 && (() => {
        const rows = data as MonthlyRow[];
        const all12 = Array.from({ length: 12 }, (_, i) => {
          const f = rows.find(r => Number(r.month) === i + 1);
          return { month: i + 1, total_sheets: f?.total_sheets ?? '0', total_operations: f?.total_operations ?? '0' };
        });
        return (
          <div className="space-y-4">
            <Card>
              <ReactECharts option={vBar(all12.map(r => MONTHS[r.month - 1]), all12.map(r => parseInt(r.total_sheets)), 'Folhas')}
                style={{ height: '220px' }} opts={{ renderer: 'svg' }} />
            </Card>
            <TableWrap>
              <table className="w-full text-[13px]">
                <thead className="bg-gray-50/80 border-b border-gray-100"><tr><Th>Mês</Th><Th right>Operações</Th><Th right>Folhas</Th></tr></thead>
                <tbody className="divide-y divide-gray-100/80">
                  {all12.filter(r => parseInt(r.total_sheets) > 0).map(r => (
                    <tr key={r.month} className="hover:bg-gray-50/40">
                      <td className="px-5 py-3 font-medium text-gray-800">{MONTHS[r.month - 1]}/{year}</td>
                      <td className="px-5 py-3 text-right text-gray-600">{r.total_operations}</td>
                      <td className="px-5 py-3 text-right font-bold text-gray-900">{r.total_sheets}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </div>
        );
      })()}

      {/* ── Peak Hours ── */}
      {!loading && tab === 'hours' && (() => {
        const rows: HourRow[] = data.length > 0
          ? data as HourRow[]
          : Array.from({ length: 24 }, (_, h) => ({ hour: h, total_operations: 0, total_sheets: 0 }));
        const labels = rows.map(r => `${String(r.hour).padStart(2, '0')}h`);
        return (
          <div className="space-y-4">
            <Card>
              <p className="text-[12px] font-medium text-gray-500 uppercase tracking-wide mb-3">Operações por horário</p>
              <ReactECharts option={vBar(labels, rows.map(r => r.total_operations), 'Operações')}
                style={{ height: '200px' }} opts={{ renderer: 'svg' }} />
            </Card>
            <Card>
              <p className="text-[12px] font-medium text-gray-500 uppercase tracking-wide mb-3">Folhas impressas por horário</p>
              <ReactECharts option={vBar(labels, rows.map(r => r.total_sheets), 'Folhas', '#48484a')}
                style={{ height: '200px' }} opts={{ renderer: 'svg' }} />
            </Card>
          </div>
        );
      })()}

      {/* ── By Operator ── */}
      {!loading && tab === 'operator' && data.length > 0 && (() => {
        const rows = data as OperatorRow[];
        const h = `${Math.max(160, rows.length * 40)}px`;
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Card>
                <p className="text-[12px] font-medium text-gray-500 uppercase tracking-wide mb-2">Operações</p>
                <ReactECharts option={hBar([...rows].reverse().map(r => r.operator), [...rows].reverse().map(r => parseInt(r.total_operations)), 'Operações')}
                  style={{ height: h }} opts={{ renderer: 'svg' }} />
              </Card>
              <Card>
                <p className="text-[12px] font-medium text-gray-500 uppercase tracking-wide mb-2">Distribuição</p>
                <ReactECharts option={pie(rows.map(r => ({ name: r.operator, value: parseInt(r.total_operations) })))}
                  style={{ height: h }} opts={{ renderer: 'svg' }} />
              </Card>
            </div>
            <TableWrap>
              <table className="w-full text-[13px]">
                <thead className="bg-gray-50/80 border-b border-gray-100"><tr><Th>Operador</Th><Th right>Operações</Th><Th right>Folhas</Th></tr></thead>
                <tbody className="divide-y divide-gray-100/80">
                  {rows.map(r => (
                    <tr key={r.operator} className="hover:bg-gray-50/40">
                      <td className="px-5 py-3 font-medium text-gray-900">{r.operator}</td>
                      <td className="px-5 py-3 text-right font-bold text-gray-900">{r.total_operations}</td>
                      <td className="px-5 py-3 text-right text-gray-600">{r.total_sheets}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </div>
        );
      })()}

      {/* ── Own vs Borrowed ── */}
      {!loading && tab === 'loan-type' && data.length > 0 && (() => {
        const rows = data as LoanTypeRow[];
        const total = rows.reduce((a, r) => a + parseInt(r.total_sheets), 0);
        return (
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <ReactECharts option={pie(rows.map(r => ({ name: TYPE_LABEL[r.type] || r.type, value: parseInt(r.total_sheets) })))}
                style={{ height: '260px' }} opts={{ renderer: 'svg' }} />
            </Card>
            <div className="bg-white/70 backdrop-blur-xl border border-white/60 rounded-2xl shadow-glass p-5 space-y-4">
              <p className="text-[12px] font-medium text-gray-500 uppercase tracking-wide">Resumo</p>
              {rows.map(r => {
                const pct = total > 0 ? Math.round(parseInt(r.total_sheets) / total * 100) : 0;
                return (
                  <div key={r.type}>
                    <div className="flex justify-between items-baseline mb-1">
                      <span className="text-[13px] text-gray-700">{TYPE_LABEL[r.type] || r.type}</span>
                      <span className="text-[22px] font-bold text-gray-900">{r.total_sheets}</span>
                    </div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <div className="flex-1 h-[3px] bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-gray-800 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[11px] text-gray-400 shrink-0">{pct}%</span>
                    </div>
                    <p className="text-[11px] text-gray-400">{r.total_operations} operações</p>
                  </div>
                );
              })}
              <div className="pt-2 border-t border-gray-100">
                <p className="text-[12px] text-gray-500">Total: <span className="font-bold text-gray-900">{total} folhas</span></p>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Identify Method ── */}
      {!loading && tab === 'identify-method' && data.length > 0 && (() => {
        const rows = data as IdentifyMethodRow[];
        const total = rows.reduce((a, r) => a + parseInt(r.total_operations), 0);
        return (
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <p className="text-[12px] font-medium text-gray-500 uppercase tracking-wide mb-3">Distribuição por método</p>
              <ReactECharts
                option={pie(rows.map(r => ({ name: METHOD_LABEL[r.identify_method] || r.identify_method, value: parseInt(r.total_operations) })))}
                style={{ height: '260px' }}
                opts={{ renderer: 'svg' }}
              />
            </Card>
            <div className="bg-white/70 backdrop-blur-xl border border-white/60 rounded-2xl shadow-glass p-5 space-y-4">
              <p className="text-[12px] font-medium text-gray-500 uppercase tracking-wide">Resumo</p>
              {rows.map(r => {
                const pct = total > 0 ? Math.round(parseInt(r.total_operations) / total * 100) : 0;
                const colorMap: Record<string, string> = { manual: 'bg-gray-800', rfid: 'bg-blue-500', facial: 'bg-purple-500' };
                return (
                  <div key={r.identify_method}>
                    <div className="flex justify-between items-baseline mb-1">
                      <span className="text-[13px] text-gray-700">{METHOD_LABEL[r.identify_method] || r.identify_method}</span>
                      <span className="text-[20px] font-bold text-gray-900">{r.total_operations}</span>
                    </div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <div className="flex-1 h-[3px] bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${colorMap[r.identify_method] ?? 'bg-gray-800'}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[11px] text-gray-400 shrink-0">{pct}%</span>
                    </div>
                    <p className="text-[11px] text-gray-400">{r.total_sheets} folhas impressas</p>
                  </div>
                );
              })}
              <div className="pt-2 border-t border-gray-100">
                <p className="text-[12px] text-gray-500">Total: <span className="font-bold text-gray-900">{total} operações</span></p>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Audit ── */}
      {!loading && tab === 'audit' && data.length > 0 && (
        <TableWrap>
          <div className="divide-y divide-gray-100/80">
            {(data as AuditEntry[]).map(r => (
              <div key={r.id} className="px-5 py-4">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-[13px] font-medium text-gray-900">{r.student_name}</p>
                    <p className="text-[12px] text-gray-500">{r.registration_number} · por {r.operator_login}</p>
                  </div>
                  <span className="text-[11px] text-gray-400 shrink-0">{formatDate(r.created_at)}</span>
                </div>
                <p className="text-[12px] text-gray-600 mt-1.5">
                  Lançamento #{r.entry_id}: <span className="line-through">{r.previous_value}</span> &rarr; <strong>{r.new_value} folhas</strong>
                </p>
                <p className="text-[12px] text-gray-500 mt-0.5 italic">"{r.reason}"</p>
              </div>
            ))}
          </div>
        </TableWrap>
      )}

      {/* ── Top Student Modal ── */}
      <Modal open={!!selectedTop} onClose={() => setSelectedTop(null)} title="Histórico do Aluno" size="xl">
        {selectedTop && (
          <div className="space-y-4">
            <div className="flex gap-4">
              <Avatar photo={topPhoto} name={selectedTop.name} size="md" />
              <div>
                <p className="text-[15px] font-semibold text-gray-900">{selectedTop.name}</p>
                <p className="text-[12px] text-gray-500 mt-0.5">{selectedTop.registration_number}</p>
                <p className="text-[12px] text-gray-500">{selectedTop.course}{selectedTop.period && ` · ${selectedTop.period}`}</p>
                <p className="text-[12px] font-medium text-gray-700 mt-1">{selectedTop.total_sheets} folhas no período selecionado</p>
              </div>
            </div>
            {topModalLoading ? (
              <div className="flex justify-center py-8"><Spinner /></div>
            ) : topHistory.length === 0 ? (
              <p className="text-center text-[13px] text-gray-400 py-4">Nenhum registro encontrado.</p>
            ) : (
              <div className="rounded-xl border border-gray-100 overflow-hidden">
                <table className="w-full text-[13px]">
                  <thead className="bg-gray-50/80 border-b border-gray-100">
                    <tr><Th>Data</Th><Th>Tipo</Th><Th>Operador</Th><Th right>Folhas</Th></tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {topHistory.map(e => (
                      <tr key={e.id} className="hover:bg-gray-50/40">
                        <td className="px-4 py-2.5 text-gray-600">{formatDate(e.created_at)}</td>
                        <td className="px-4 py-2.5">
                          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${e.type === 'own' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>
                            {ENTRY_TYPE_LABELS[e.type]}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-gray-500">{e.operator_login}</td>
                        <td className="px-4 py-2.5 text-right font-bold text-gray-900">{e.sheets}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
