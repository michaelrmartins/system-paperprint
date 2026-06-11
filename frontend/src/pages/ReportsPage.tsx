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
import { useTheme } from '../hooks/useTheme';

// ─── Types ────────────────────────────────────────────────────────────────────
type ReportTab = 'course' | 'period' | 'top' | 'monthly' | 'daily' | 'hours' | 'operator' | 'loan-type' | 'identify-method' | 'history' | 'audit' | 'invalid-docs' | 'employees' | 'waste';

interface CourseRow    { course: string; total_sheets: string }
interface PeriodRow    { period: string; course: string; total_sheets: string }
interface TopRow       { id: number; name: string; registration_number: string; course: string; period: string; total_sheets: string }
interface EmployeeRow  { id: number; name: string; employee_code: string; department: string; total_sheets: string }
interface WasteEvent   { id: number; type: 'error' | 'blank'; sheets: number; operator_login: string; created_at: string }
interface WasteDayRow  { day: string; type: 'error' | 'blank'; total_sheets: number; total_events: number }
interface WasteSummary { error_sheets: number; blank_sheets: number; total_events: number; events: WasteEvent[]; by_date: WasteDayRow[] }
interface MonthlyRow   { month: number; total_sheets: string; total_operations: string }
interface DailyRow     { day: string; total_sheets: string; total_operations: string }
interface HourRow      { hour: number; total_operations: number; total_sheets: number }
interface OperatorRow  { operator: string; total_operations: string; total_sheets: string }
interface LoanTypeRow        { type: 'own' | 'borrowed'; total_sheets: string; total_operations: string }
interface IdentifyMethodRow  { identify_method: 'manual' | 'rfid' | 'facial'; total_operations: string; total_sheets: string }
interface InvalidDocRow      { id: number; document: string; situation_detail: string; context: 'primary' | 'loan'; identify_method: 'manual' | 'rfid' | 'facial'; created_at: string; operator_login: string; primary_student_name: string | null; primary_student_registration: string | null }

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
function hBar(categories: string[], values: number[], name = 'Folhas', gridLeft: number | string = 6, theme: 'light' | 'dark' = 'light') {
  const isDark = theme === 'dark';
  const grid = typeof gridLeft === 'number' && gridLeft === 6
    ? { left: 6, right: 20, top: 6, bottom: 6, containLabel: true }
    : { left: gridLeft, right: 20, top: 6, bottom: 6 };
  return {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid,
    xAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: isDark ? '#3a3a3c' : '#f5f5f7', type: 'dashed' as const } },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { fontSize: 10, color: isDark ? '#636366' : '#8e8e93' },
    },
    yAxis: {
      type: 'category',
      data: categories,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { fontSize: 11, color: isDark ? '#d1d1d6' : '#3a3a3c' },
    },
    series: [{ name, type: 'bar', data: values, itemStyle: { color: isDark ? '#f5f5f7' : '#1c1c1e', borderRadius: [0, 3, 3, 0] }, barMaxWidth: 18 }],
  };
}

function vBar(categories: string[], values: number[], name = 'Total', color = '', theme: 'light' | 'dark' = 'light') {
  const isDark = theme === 'dark';
  const resolvedColor = color || (isDark ? '#f5f5f7' : '#1c1c1e');
  return {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' as const } },
    grid: { left: 8, right: 8, top: 10, bottom: 8, containLabel: true },
    xAxis: {
      type: 'category',
      data: categories,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { fontSize: 10, color: isDark ? '#aeaeb2' : '#636366' },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: isDark ? '#3a3a3c' : '#f5f5f7', type: 'dashed' as const } },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { fontSize: 10, color: isDark ? '#636366' : '#8e8e93' },
    },
    series: [{ name, type: 'bar', data: values, itemStyle: { color: resolvedColor, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 28 }],
  };
}

function pie(data: { name: string; value: number }[], theme: 'light' | 'dark' = 'light') {
  const isDark = theme === 'dark';
  return {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { bottom: '2%', itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 11, color: isDark ? '#aeaeb2' : '#48484a' } },
    color: ['#1c1c1e', '#636366', '#aeaeb2', '#d1d1d6', '#e5e5ea'],
    series: [{
      type: 'pie', radius: ['38%', '65%'], center: ['50%', '44%'], data,
      label: { fontSize: 10, formatter: '{d}%' },
      itemStyle: { borderWidth: 2, borderColor: isDark ? '#1c1c1e' : '#ffffff' },
    }],
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function Avatar({ photo, name, size = 'sm' }: { photo?: string | null; name: string; size?: 'sm' | 'md' }) {
  const base = size === 'sm' ? 'w-8 h-8 rounded-lg text-[12px]' : 'w-12 h-12 rounded-xl text-[16px]';
  if (photo) return <img src={`data:image/jpeg;base64,${photo}`} alt={name} className={`${base} object-cover border border-white/60 dark:border-white/10 shadow-sm shrink-0`} />;
  return <div className={`${base} bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex items-center justify-center font-semibold text-gray-500 dark:text-gray-400 shrink-0`}>{name.charAt(0).toUpperCase()}</div>;
}

function LazyAvatar({ studentId, name }: { studentId: number; name: string }) {
  const [photo, setPhoto] = useState<string | null>(null);
  useEffect(() => {
    api.get<{ photo: string | null }>(`/students/${studentId}/photo`).then(r => setPhoto(r.data.photo)).catch(() => {});
  }, [studentId]);
  return <Avatar photo={photo} name={name} size="sm" />;
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-white/70 dark:bg-gray-900/70 backdrop-blur-xl border border-white/60 dark:border-white/10 rounded-2xl shadow-glass dark:shadow-glass-dark p-4">{children}</div>;
}

function TableWrap({ children }: { children: React.ReactNode }) {
  return <div className="bg-white/70 dark:bg-gray-900/70 backdrop-blur-xl border border-white/60 dark:border-white/10 rounded-2xl shadow-glass dark:shadow-glass-dark overflow-hidden">{children}</div>;
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`${right ? 'text-right' : 'text-left'} px-5 py-3 font-medium text-gray-500 dark:text-gray-400 text-[14px]`}>{children}</th>;
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export function ReportsPage() {
  const { theme } = useTheme();
  const [tab, setTab] = useState<ReportTab>('course');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
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
  const [topHistoryPage, setTopHistoryPage] = useState(1);
  const TOP_HISTORY_PAGE_SIZE = 10;

  // Waste tab
  const [wasteSummary, setWasteSummary] = useState<WasteSummary | null>(null);

  // Invalid docs pagination
  const [invDocsPage, setInvDocsPage] = useState(1);
  const INV_DOCS_PAGE_SIZE = 10;

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
    setLoadError('');
    try {
      const params = new URLSearchParams();
      if (tab === 'monthly') { params.set('year', year); }
      else { if (start) params.set('start', start); if (end) params.set('end', end); }

      if (tab === 'waste') {
        const res = await api.get<WasteSummary>(`/waste/summary?${params}`);
        setWasteSummary(res.data);
        return;
      }

      const ep: Record<string, string> = {
        course: '/reports/by-course', period: '/reports/by-period',
        top: '/reports/top-students', monthly: '/reports/monthly',
        daily: '/reports/daily',
        hours: '/reports/by-hour', operator: '/reports/by-operator',
        'loan-type': '/reports/own-vs-borrowed', 'identify-method': '/reports/by-identify-method',
        audit: '/reports/audit', 'invalid-docs': '/reports/invalid-documents',
        employees: '/reports/top-employees',
      };
      const res = await api.get<unknown[]>(`${ep[tab]}?${params}`);
      setData(res.data);
      setExpandedPeriods(new Set());
      setPeriodStudents({});
    } catch {
      setLoadError('Não foi possível carregar os dados. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setData([]);
    setWasteSummary(null);
    setLoadError('');
    setExpandedPeriods(new Set());
    setPeriodStudents({});
    setInvDocsPage(1);
    if (tab !== 'history') load();
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const togglePeriod = async (key: string, period: string, course: string) => {
    const next = new Set(expandedPeriods);
    if (next.has(key)) { next.delete(key); }
    else {
      next.add(key);
      if (!periodStudents[key]) {
        setPeriodStudentsLoading(p => ({ ...p, [key]: true }));
        try {
          const params = new URLSearchParams({ period, course });
          if (start) params.set('start', start);
          if (end) params.set('end', end);
          const res = await api.get<PeriodStudent[]>(`/reports/period-students?${params}`);
          setPeriodStudents(p => ({ ...p, [key]: res.data }));
        } finally {
          setPeriodStudentsLoading(p => ({ ...p, [key]: false }));
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
    setTopHistoryPage(1);
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
      const idRes = await api.post<{ user: { id: number } }>('/students/identify/manual', { registration_number: histReg.trim() });
      const sid = idRes.data.user.id;
      setHistStudentId(sid);
      const params = new URLSearchParams();
      if (histDate) params.set('date', histDate);
      const hRes = await api.get<HistoryEntry[]>(`/students/${sid}/history?${params}`);
      setHistData(hRes.data);
    } catch { setHistError('Aluno não encontrado.'); }
    finally { setHistSearching(false); }
  };

  const tabs: { key: ReportTab; label: string }[] = [
    { key: 'course',          label: 'Por Curso' },
    { key: 'period',          label: 'Por Período' },
    { key: 'top',             label: 'Top Alunos' },
    { key: 'employees',       label: 'Funcionários' },
    { key: 'monthly',         label: 'Mensal' },
    { key: 'daily',           label: 'Diário' },
    { key: 'hours',           label: 'Horários de Pico' },
    { key: 'operator',        label: 'Por Operador' },
    { key: 'loan-type',       label: 'Próprias vs Emp.' },
    { key: 'identify-method', label: 'Identificação' },
    { key: 'waste',           label: 'Erros e Folhas em Branco' },
    { key: 'history',         label: 'Histórico' },
    { key: 'audit',           label: 'Auditoria' },
    { key: 'invalid-docs',    label: 'Docs. Inválidos' },
  ];

  const noData = !loading && data.length === 0 && tab !== 'history' && tab !== 'hours' && tab !== 'waste';

  return (
    <div className="space-y-4">
      <h1 className="text-[20px] font-semibold text-gray-900 dark:text-white">Relatórios</h1>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-gray-100/80 dark:bg-gray-800/60 rounded-xl overflow-x-auto">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`shrink-0 px-3 py-2 rounded-lg text-[13px] font-medium transition-all ${tab === t.key ? 'bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      {tab !== 'history' && (
        <div className="flex gap-2 items-end flex-wrap">
          {tab === 'monthly' ? (
            <input type="number" value={year} onChange={e => setYear(e.target.value)}
              className="w-24 px-3 py-2 text-[14px] border border-gray-200 dark:border-gray-700 rounded-xl outline-none focus:border-gray-400 dark:focus:border-gray-500 bg-white/70 dark:bg-gray-900/70 text-gray-900 dark:text-white" placeholder="Ano" />
          ) : (
            <>
              <input type="date" value={start} onChange={e => setStart(e.target.value)}
                className="px-3 py-2 text-[14px] border border-gray-200 dark:border-gray-700 rounded-xl outline-none focus:border-gray-400 dark:focus:border-gray-500 bg-white/70 dark:bg-gray-900/70 text-gray-900 dark:text-white" />
              <input type="date" value={end} onChange={e => setEnd(e.target.value)}
                className="px-3 py-2 text-[14px] border border-gray-200 dark:border-gray-700 rounded-xl outline-none focus:border-gray-400 dark:focus:border-gray-500 bg-white/70 dark:bg-gray-900/70 text-gray-900 dark:text-white" />
            </>
          )}
          <Button onClick={load} loading={loading} size="sm" variant="secondary">Filtrar</Button>
        </div>
      )}

      {loading && <div className="flex justify-center py-12"><Spinner /></div>}
      {loadError && <p className="text-center text-[15px] text-red-500 py-12">{loadError}</p>}
      {noData && !loadError && <p className="text-center text-[15px] text-gray-400 dark:text-gray-500 py-12">Sem dados para o período.</p>}

      {/* ── History ── */}
      {tab === 'history' && (
        <div className="space-y-4">
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Input label="Matrícula" value={histReg} onChange={e => setHistReg(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && searchHistory()} placeholder="Digite a matrícula" />
            </div>
            <input type="date" value={histDate} onChange={e => setHistDate(e.target.value)}
              className="px-3 py-2 text-[14px] border border-gray-200 dark:border-gray-700 rounded-xl outline-none focus:border-gray-400 dark:focus:border-gray-500 bg-white/70 dark:bg-gray-900/70 text-gray-900 dark:text-white self-end" />
            <Button onClick={searchHistory} loading={histSearching} size="sm" variant="secondary" className="self-end">
              <Search size={16} /> Buscar
            </Button>
          </div>
          {histError && <p className="text-[14px] text-red-500">{histError}</p>}
          {histData.length > 0 && (
            <TableWrap>
              <table className="w-full text-[14px]">
                <thead className="bg-gray-50/80 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800"><tr><Th>Data</Th><Th>Tipo</Th><Th>Operação</Th><Th right>Folhas</Th></tr></thead>
                <tbody className="divide-y divide-gray-100/80 dark:divide-gray-800/50">
                  {histData.map(e => (
                    <tr key={e.id} className="hover:bg-gray-50/40 dark:hover:bg-gray-800/30">
                      <td className="px-5 py-3 text-gray-600 dark:text-gray-300">{formatDate(e.created_at)}</td>
                      <td className="px-5 py-3"><span className={`text-[12px] font-medium px-2 py-0.5 rounded-full ${e.type === 'own' ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400' : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400'}`}>{ENTRY_TYPE_LABELS[e.type]}</span></td>
                      <td className="px-5 py-3 text-gray-500 dark:text-gray-400">#{e.operation_id} · {e.operator_login}</td>
                      <td className="px-5 py-3 text-right font-bold text-gray-900 dark:text-white">{e.sheets}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-800/40">
                  <tr>
                    <td colSpan={3} className="px-5 py-3 text-[14px] text-gray-500 dark:text-gray-400">
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
            <p className="text-center text-[15px] text-gray-400 dark:text-gray-500 py-8">Nenhuma impressão encontrada.</p>
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
              <ReactECharts option={hBar(rev.map(r => r.course || '—'), rev.map(r => parseInt(r.total_sheets)), 'Folhas', 6, theme)}
                style={{ height: `${Math.max(200, rows.length * 32)}px` }} opts={{ renderer: 'svg' }} />
            </Card>
            <TableWrap>
              <table className="w-full text-[14px]">
                <thead className="bg-gray-50/80 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800"><tr><Th>Curso</Th><Th right>Folhas</Th></tr></thead>
                <tbody className="divide-y divide-gray-100/80 dark:divide-gray-800/50">
                  {rows.map(r => (
                    <tr key={r.course} className="hover:bg-gray-50/40 dark:hover:bg-gray-800/30">
                      <td className="px-5 py-3 text-gray-800 dark:text-gray-100">{r.course || '—'}</td>
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
        const label = (r: PeriodRow) => r.course ? `${r.period || '—'} - ${r.course}` : (r.period || '—');
        const rev = [...rows].reverse();
        return (
          <div className="space-y-4">
            <Card>
              <ReactECharts option={hBar(rev.map(label), rev.map(r => parseInt(r.total_sheets)), 'Folhas', 185, theme)}
                style={{ height: `${Math.max(180, rows.length * 36)}px` }} opts={{ renderer: 'svg' }} />
            </Card>
            <TableWrap>
              {rows.map(r => {
                const key = `${r.period}|${r.course}`;
                const isOpen = expandedPeriods.has(key);
                const students = periodStudents[key] ?? [];
                const loadingSt = periodStudentsLoading[key];
                return (
                  <div key={key} className="border-b border-gray-100/80 dark:border-gray-800/50 last:border-0">
                    <button onClick={() => togglePeriod(key, r.period, r.course)}
                      className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50/50 dark:hover:bg-gray-800/40 transition-colors text-left">
                      <div className="flex items-center gap-2">
                        {isOpen ? <ChevronDown size={16} className="text-gray-400 dark:text-gray-500 shrink-0" /> : <ChevronRight size={16} className="text-gray-400 dark:text-gray-500 shrink-0" />}
                        <div>
                          <span className="text-[15px] font-medium text-gray-900 dark:text-white">{r.period || '—'}</span>
                          {r.course && <span className="ml-2 text-[13px] text-gray-400 dark:text-gray-500">{r.course}</span>}
                        </div>
                      </div>
                      <span className="text-[15px] font-bold text-gray-900 dark:text-white">{r.total_sheets} folhas</span>
                    </button>
                    {isOpen && (
                      <div className="px-5 pb-3 bg-gray-50/40 dark:bg-gray-800/40">
                        {loadingSt ? (
                          <div className="flex items-center gap-2 py-3 text-[14px] text-gray-400 dark:text-gray-500"><Spinner size="sm" /> Carregando...</div>
                        ) : students.length === 0 ? (
                          <p className="text-[14px] text-gray-400 dark:text-gray-500 py-2">Nenhum aluno encontrado.</p>
                        ) : (
                          <div className="space-y-1 pt-1">
                            {students.map(s => (
                              <div key={s.id} className="flex items-center gap-3 py-1.5 px-2 rounded-xl hover:bg-white/60 dark:hover:bg-gray-800/40 transition-colors">
                                <LazyAvatar studentId={s.id} name={s.name} />
                                <div className="flex-1 min-w-0">
                                  <p className="text-[14px] font-medium text-gray-900 dark:text-white truncate">{s.name}</p>
                                  <p className="text-[12px] text-gray-400 dark:text-gray-500">{s.registration_number}</p>
                                </div>
                                <span className="text-[14px] font-bold text-gray-700 dark:text-gray-200 shrink-0">{s.total_sheets} folhas</span>
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
              <ReactECharts option={hBar(rev.map(r => r.name), rev.map(r => parseInt(r.total_sheets)), 'Folhas', 6, theme)}
                style={{ height: `${Math.max(200, top10.length * 32)}px` }} opts={{ renderer: 'svg' }} />
            </Card>
            <TableWrap>
              <table className="w-full text-[14px]">
                <thead className="bg-gray-50/80 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800"><tr><Th>#</Th><Th>Aluno</Th><Th right>Folhas</Th></tr></thead>
                <tbody className="divide-y divide-gray-100/80 dark:divide-gray-800/50">
                  {rows.map((r, i) => (
                    <tr key={r.id} onClick={() => openTopModal(r)}
                      className="hover:bg-gray-50/60 dark:hover:bg-gray-800/40 cursor-pointer active:bg-gray-100/60 dark:active:bg-gray-800/60 transition-colors">
                      <td className="px-5 py-3 text-gray-400 dark:text-gray-500 font-medium w-10">{i + 1}</td>
                      <td className="px-5 py-3">
                        <p className="font-medium text-gray-900 dark:text-white">{r.name}</p>
                        <p className="text-[12px] text-gray-400 dark:text-gray-500">{r.registration_number} · {r.course}</p>
                      </td>
                      <td className="px-5 py-3 text-right font-bold text-gray-900 dark:text-white">{r.total_sheets}</td>
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
              <ReactECharts option={vBar(all12.map(r => MONTHS[r.month - 1]), all12.map(r => parseInt(r.total_sheets)), 'Folhas', '', theme)}
                style={{ height: '220px' }} opts={{ renderer: 'svg' }} />
            </Card>
            <TableWrap>
              <table className="w-full text-[14px]">
                <thead className="bg-gray-50/80 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800"><tr><Th>Mês</Th><Th right>Operações</Th><Th right>Folhas</Th></tr></thead>
                <tbody className="divide-y divide-gray-100/80 dark:divide-gray-800/50">
                  {all12.filter(r => parseInt(r.total_sheets) > 0).map(r => (
                    <tr key={r.month} className="hover:bg-gray-50/40 dark:hover:bg-gray-800/30">
                      <td className="px-5 py-3 font-medium text-gray-800 dark:text-gray-100">{MONTHS[r.month - 1]}/{year}</td>
                      <td className="px-5 py-3 text-right text-gray-600 dark:text-gray-300">{r.total_operations}</td>
                      <td className="px-5 py-3 text-right font-bold text-gray-900 dark:text-white">{r.total_sheets}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </div>
        );
      })()}

      {/* ── Daily ── */}
      {!loading && tab === 'daily' && data.length > 0 && (() => {
        const rows = data as DailyRow[];
        const fmt = (d: string) => { const s = String(d ?? '').slice(0, 10); const [y, m, dd] = s.split('-'); return dd ? `${dd}/${m}/${y.slice(2)}` : s; };
        return (
          <div className="space-y-4">
            <Card>
              <p className="text-[13px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Folhas por dia</p>
              <ReactECharts
                option={vBar(rows.map(r => fmt(r.day)), rows.map(r => parseInt(r.total_sheets)), 'Folhas', '', theme)}
                style={{ height: '220px' }}
                opts={{ renderer: 'svg' }}
              />
            </Card>
            <TableWrap>
              <table className="w-full text-[14px]">
                <thead className="bg-gray-50/80 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800">
                  <tr><Th>Data</Th><Th right>Operações</Th><Th right>Folhas</Th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100/80 dark:divide-gray-800/50">
                  {rows.map(r => (
                    <tr key={r.day} className="hover:bg-gray-50/40 dark:hover:bg-gray-800/30">
                      <td className="px-5 py-3 font-medium text-gray-800 dark:text-gray-100">{fmt(r.day)}</td>
                      <td className="px-5 py-3 text-right text-gray-600 dark:text-gray-300">{r.total_operations}</td>
                      <td className="px-5 py-3 text-right font-bold text-gray-900 dark:text-white">{r.total_sheets}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-800/40">
                  <tr>
                    <td className="px-5 py-3 text-[14px] text-gray-500 dark:text-gray-400">
                      {rows.length} dia{rows.length !== 1 ? 's' : ''}
                    </td>
                    <td className="px-5 py-3 text-right font-bold">{rows.reduce((a, r) => a + parseInt(r.total_operations), 0)}</td>
                    <td className="px-5 py-3 text-right font-bold">{rows.reduce((a, r) => a + parseInt(r.total_sheets), 0)}</td>
                  </tr>
                </tfoot>
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
              <p className="text-[13px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Operações por horário</p>
              <ReactECharts option={vBar(labels, rows.map(r => r.total_operations), 'Operações', '', theme)}
                style={{ height: '200px' }} opts={{ renderer: 'svg' }} />
            </Card>
            <Card>
              <p className="text-[13px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Folhas impressas por horário</p>
              <ReactECharts option={vBar(labels, rows.map(r => r.total_sheets), 'Folhas', theme === 'dark' ? '#aeaeb2' : '#48484a', theme)}
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
                <p className="text-[13px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Operações</p>
                <ReactECharts option={hBar([...rows].reverse().map(r => r.operator), [...rows].reverse().map(r => parseInt(r.total_operations)), 'Operações', 6, theme)}
                  style={{ height: h }} opts={{ renderer: 'svg' }} />
              </Card>
              <Card>
                <p className="text-[13px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Distribuição</p>
                <ReactECharts option={pie(rows.map(r => ({ name: r.operator, value: parseInt(r.total_operations) })), theme)}
                  style={{ height: h }} opts={{ renderer: 'svg' }} />
              </Card>
            </div>
            <TableWrap>
              <table className="w-full text-[14px]">
                <thead className="bg-gray-50/80 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800"><tr><Th>Operador</Th><Th right>Operações</Th><Th right>Folhas</Th></tr></thead>
                <tbody className="divide-y divide-gray-100/80 dark:divide-gray-800/50">
                  {rows.map(r => (
                    <tr key={r.operator} className="hover:bg-gray-50/40 dark:hover:bg-gray-800/30">
                      <td className="px-5 py-3 font-medium text-gray-900 dark:text-white">{r.operator}</td>
                      <td className="px-5 py-3 text-right font-bold text-gray-900 dark:text-white">{r.total_operations}</td>
                      <td className="px-5 py-3 text-right text-gray-600 dark:text-gray-300">{r.total_sheets}</td>
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
              <ReactECharts option={pie(rows.map(r => ({ name: TYPE_LABEL[r.type] || r.type, value: parseInt(r.total_sheets) })), theme)}
                style={{ height: '260px' }} opts={{ renderer: 'svg' }} />
            </Card>
            <div className="bg-white/70 dark:bg-gray-900/70 backdrop-blur-xl border border-white/60 dark:border-white/10 rounded-2xl shadow-glass dark:shadow-glass-dark p-5 space-y-4">
              <p className="text-[13px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Resumo</p>
              {rows.map(r => {
                const pct = total > 0 ? Math.round(parseInt(r.total_sheets) / total * 100) : 0;
                return (
                  <div key={r.type}>
                    <div className="flex justify-between items-baseline mb-1">
                      <span className="text-[14px] text-gray-700 dark:text-gray-200">{TYPE_LABEL[r.type] || r.type}</span>
                      <span className="text-[22px] font-bold text-gray-900 dark:text-white">{r.total_sheets}</span>
                    </div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <div className="flex-1 h-[3px] bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                        <div className="h-full bg-gray-800 dark:bg-gray-200 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[12px] text-gray-400 dark:text-gray-500 shrink-0">{pct}%</span>
                    </div>
                    <p className="text-[12px] text-gray-400 dark:text-gray-500">{r.total_operations} operações</p>
                  </div>
                );
              })}
              <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
                <p className="text-[13px] text-gray-500 dark:text-gray-400">Total: <span className="font-bold text-gray-900 dark:text-white">{total} folhas</span></p>
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
              <p className="text-[13px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Distribuição por método</p>
              <ReactECharts
                option={pie(rows.map(r => ({ name: METHOD_LABEL[r.identify_method] || r.identify_method, value: parseInt(r.total_operations) })), theme)}
                style={{ height: '260px' }}
                opts={{ renderer: 'svg' }}
              />
            </Card>
            <div className="bg-white/70 dark:bg-gray-900/70 backdrop-blur-xl border border-white/60 dark:border-white/10 rounded-2xl shadow-glass dark:shadow-glass-dark p-5 space-y-4">
              <p className="text-[13px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Resumo</p>
              {rows.map(r => {
                const pct = total > 0 ? Math.round(parseInt(r.total_operations) / total * 100) : 0;
                const colorMap: Record<string, string> = { manual: 'bg-gray-800', rfid: 'bg-blue-500', facial: 'bg-purple-500' };
                return (
                  <div key={r.identify_method}>
                    <div className="flex justify-between items-baseline mb-1">
                      <span className="text-[14px] text-gray-700 dark:text-gray-200">{METHOD_LABEL[r.identify_method] || r.identify_method}</span>
                      <span className="text-[20px] font-bold text-gray-900 dark:text-white">{r.total_operations}</span>
                    </div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <div className="flex-1 h-[3px] bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${colorMap[r.identify_method] ?? 'bg-gray-800'}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[12px] text-gray-400 dark:text-gray-500 shrink-0">{pct}%</span>
                    </div>
                    <p className="text-[12px] text-gray-400 dark:text-gray-500">{r.total_sheets} folhas impressas</p>
                  </div>
                );
              })}
              <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
                <p className="text-[13px] text-gray-500 dark:text-gray-400">Total: <span className="font-bold text-gray-900 dark:text-white">{total} operações</span></p>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Audit ── */}
      {!loading && tab === 'audit' && data.length > 0 && (
        <TableWrap>
          <div className="divide-y divide-gray-100/80 dark:divide-gray-800/50">
            {(data as AuditEntry[]).map(r => (
              <div key={r.id} className="px-5 py-4">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-[14px] font-medium text-gray-900 dark:text-white">{r.student_name}</p>
                    <p className="text-[13px] text-gray-500 dark:text-gray-400">{r.registration_number} · por {r.operator_login}</p>
                  </div>
                  <span className="text-[12px] text-gray-400 dark:text-gray-500 shrink-0">{formatDate(r.created_at)}</span>
                </div>
                <p className="text-[13px] text-gray-600 dark:text-gray-300 mt-1.5">
                  Lançamento #{r.entry_id}: <span className="line-through">{r.previous_value}</span> &rarr; <strong>{r.new_value} folhas</strong>
                </p>
                <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-0.5 italic">"{r.reason}"</p>
              </div>
            ))}
          </div>
        </TableWrap>
      )}

      {/* ── Invalid Documents ── */}
      {!loading && tab === 'invalid-docs' && data.length > 0 && (() => {
        const rows = data as InvalidDocRow[];
        const totalPages = Math.ceil(rows.length / INV_DOCS_PAGE_SIZE);
        const pageRows = rows.slice((invDocsPage - 1) * INV_DOCS_PAGE_SIZE, invDocsPage * INV_DOCS_PAGE_SIZE);
        const CONTEXT_LABEL: Record<string, string> = { primary: 'Solicitante', loan: 'Emprestador' };
        const METHOD_LBL: Record<string, string> = { manual: 'Manual', rfid: 'Cartão', facial: 'Facial' };
        const fmt = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
        return (
          <TableWrap>
            <table className="w-full text-[14px]">
              <thead className="bg-gray-50/80 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800">
                <tr><Th>Doc. inválido</Th><Th>Situação</Th><Th>Papel</Th><Th>Solicitante</Th><Th>Método</Th><Th>Operador</Th><Th right>Data/Hora</Th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100/80 dark:divide-gray-800/50">
                {pageRows.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50/40 dark:hover:bg-gray-800/30">
                    <td className="px-5 py-3 font-mono font-medium text-gray-900 dark:text-white">{r.document}</td>
                    <td className="px-5 py-3">
                      <span className="text-[12px] font-medium px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400">{r.situation_detail}</span>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-[12px] font-medium px-2 py-0.5 rounded-full ${r.context === 'loan' ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400' : 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400'}`}>
                        {CONTEXT_LABEL[r.context] ?? r.context}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      {r.context === 'loan' && r.primary_student_name ? (
                        <div>
                          <p className="font-medium text-gray-800 dark:text-gray-100 leading-tight">{r.primary_student_name}</p>
                          <p className="text-[12px] text-gray-400 dark:text-gray-500 font-mono leading-tight">{r.primary_student_registration}</p>
                        </div>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-gray-500 dark:text-gray-400">{METHOD_LBL[r.identify_method] ?? r.identify_method}</td>
                    <td className="px-5 py-3 text-gray-500 dark:text-gray-400">{r.operator_login}</td>
                    <td className="px-5 py-3 text-right text-gray-500 dark:text-gray-400 whitespace-nowrap">{fmt(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-800/40">
                <tr>
                  <td colSpan={4} className="px-5 py-3 text-[13px] text-gray-500 dark:text-gray-400">
                    {rows.length} tentativa{rows.length !== 1 ? 's' : ''} bloqueada{rows.length !== 1 ? 's' : ''}
                  </td>
                  <td colSpan={3} className="px-5 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <span className="text-[13px] text-gray-400 dark:text-gray-500">
                        {(invDocsPage - 1) * INV_DOCS_PAGE_SIZE + 1}–{Math.min(invDocsPage * INV_DOCS_PAGE_SIZE, rows.length)} de {rows.length}
                      </span>
                      <button
                        onClick={() => setInvDocsPage(p => Math.max(1, p - 1))}
                        disabled={invDocsPage === 1}
                        className="p-1 rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        <ChevronRight size={16} className="rotate-180" />
                      </button>
                      <button
                        onClick={() => setInvDocsPage(p => Math.min(totalPages, p + 1))}
                        disabled={invDocsPage === totalPages}
                        className="p-1 rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              </tfoot>
            </table>
          </TableWrap>
        );
      })()}

      {/* ── Employees ── */}
      {!loading && tab === 'employees' && data.length > 0 && (() => {
        const rows = data as EmployeeRow[];
        const top10 = rows.slice(0, 10);
        const rev = [...top10].reverse();
        return (
          <div className="space-y-4">
            <Card>
              <ReactECharts option={hBar(rev.map(r => r.name), rev.map(r => parseInt(r.total_sheets)), 'Folhas', 6, theme)}
                style={{ height: `${Math.max(200, top10.length * 32)}px` }} opts={{ renderer: 'svg' }} />
            </Card>
            <TableWrap>
              <table className="w-full text-[14px]">
                <thead className="bg-gray-50/80 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800">
                  <tr><Th>#</Th><Th>Funcionário</Th><Th>Código</Th><Th>Departamento</Th><Th right>Folhas</Th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100/80 dark:divide-gray-800/50">
                  {rows.map((r, i) => (
                    <tr key={r.id} className="hover:bg-gray-50/40 dark:hover:bg-gray-800/30">
                      <td className="px-5 py-3 text-gray-400 dark:text-gray-500 font-medium w-10">{i + 1}</td>
                      <td className="px-5 py-3 font-medium text-gray-900 dark:text-white">{r.name}</td>
                      <td className="px-5 py-3 font-mono text-gray-500 dark:text-gray-400">{r.employee_code}</td>
                      <td className="px-5 py-3 text-gray-500 dark:text-gray-400">{r.department || '—'}</td>
                      <td className="px-5 py-3 text-right font-bold text-gray-900 dark:text-white">{r.total_sheets}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </div>
        );
      })()}

      {/* ── Errors and blank pages ── */}
      {!loading && tab === 'waste' && wasteSummary && (() => {
        const total = wasteSummary.error_sheets + wasteSummary.blank_sheets;
        const pieData = [
          { name: 'Erros de impressão', value: wasteSummary.error_sheets },
          { name: 'Folhas em branco', value: wasteSummary.blank_sheets },
        ].filter(d => d.value > 0);

        const fmtDay = (d: string) => { const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${dd}/${m}/${y.slice(2)}`; };

        // Build daily stacked data
        const days = [...new Set(wasteSummary.by_date.map(r => String(r.day).slice(0, 10)))].sort();
        const errorByDay = new Map(wasteSummary.by_date.filter(r => r.type === 'error').map(r => [String(r.day).slice(0, 10), r.total_sheets]));
        const blankByDay = new Map(wasteSummary.by_date.filter(r => r.type === 'blank').map(r => [String(r.day).slice(0, 10), r.total_sheets]));

        const isDark = theme === 'dark';

        return (
          <div className="space-y-4">
            {/* Stat cards */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Total de folhas', value: total, color: 'text-gray-900 dark:text-white' },
                { label: 'Erros de impressão', value: wasteSummary.error_sheets, color: 'text-red-600' },
                { label: 'Folhas em branco', value: wasteSummary.blank_sheets, color: 'text-gray-500 dark:text-gray-400' },
              ].map(item => (
                <div key={item.label} className="bg-white/70 dark:bg-gray-900/70 backdrop-blur-xl border border-white/60 dark:border-white/10 rounded-2xl shadow-glass dark:shadow-glass-dark p-4 text-center">
                  <p className={`text-[28px] font-bold ${item.color}`}>{item.value}</p>
                  <p className="text-[12px] text-gray-500 dark:text-gray-400 mt-0.5">{item.label}</p>
                </div>
              ))}
            </div>

            {pieData.length > 0 && (
              <div className="grid grid-cols-2 gap-4">
                <Card>
                  <p className="text-[13px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Distribuição</p>
                  <ReactECharts
                    option={{ ...pie(pieData, theme), color: ['#dc2626', isDark ? '#4b5563' : '#d1d1d6'] }}
                    style={{ height: '220px' }} opts={{ renderer: 'svg' }} />
                </Card>
                {days.length > 0 && (
                  <Card>
                    <p className="text-[13px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Por dia</p>
                    <ReactECharts
                      option={{
                        backgroundColor: 'transparent',
                        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
                        legend: { bottom: 0, textStyle: { fontSize: 10, color: isDark ? '#aeaeb2' : '#48484a' } },
                        grid: { left: 8, right: 8, top: 8, bottom: 28, containLabel: true },
                        color: ['#dc2626', isDark ? '#4b5563' : '#d1d1d6'],
                        xAxis: { type: 'category', data: days.map(fmtDay), axisLabel: { fontSize: 10, color: isDark ? '#aeaeb2' : '#636366' }, axisLine: { show: false }, axisTick: { show: false } },
                        yAxis: { type: 'value', axisLabel: { fontSize: 10, color: isDark ? '#636366' : '#8e8e93' }, splitLine: { lineStyle: { color: isDark ? '#3a3a3c' : '#f5f5f7', type: 'dashed' as const } }, axisLine: { show: false }, axisTick: { show: false } },
                        series: [
                          { name: 'Erros', type: 'bar', stack: 'total', data: days.map(d => errorByDay.get(d) ?? 0), itemStyle: { borderRadius: [0, 0, 0, 0] }, barMaxWidth: 24 },
                          { name: 'Brancas', type: 'bar', stack: 'total', data: days.map(d => blankByDay.get(d) ?? 0), itemStyle: { borderRadius: [3, 3, 0, 0] }, barMaxWidth: 24 },
                        ],
                      }}
                      style={{ height: '220px' }} opts={{ renderer: 'svg' }} />
                  </Card>
                )}
              </div>
            )}

            {/* Events table */}
            {wasteSummary.events.length > 0 && (
              <TableWrap>
                <table className="w-full text-[14px]">
                  <thead className="bg-gray-50/80 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800">
                    <tr><Th>Tipo</Th><Th>Operador</Th><Th right>Folhas</Th><Th right>Data/Hora</Th></tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100/80 dark:divide-gray-800/50">
                    {wasteSummary.events.map(e => (
                      <tr key={e.id} className="hover:bg-gray-50/40 dark:hover:bg-gray-800/30">
                        <td className="px-5 py-3">
                          <span className={`text-[12px] font-medium px-2 py-0.5 rounded-full ${e.type === 'error' ? 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'}`}>
                            {e.type === 'error' ? 'Erro' : 'Em branco'}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-gray-500 dark:text-gray-400">{e.operator_login}</td>
                        <td className="px-5 py-3 text-right font-bold text-gray-900 dark:text-white">{e.sheets}</td>
                        <td className="px-5 py-3 text-right text-gray-400 dark:text-gray-500 whitespace-nowrap">
                          {new Date(e.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-800/40">
                    <tr>
                      <td colSpan={2} className="px-5 py-3 text-[13px] text-gray-500 dark:text-gray-400">
                        {wasteSummary.total_events} evento{wasteSummary.total_events !== 1 ? 's' : ''}
                      </td>
                      <td className="px-5 py-3 text-right font-bold">{total}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </TableWrap>
            )}

            {wasteSummary.events.length === 0 && (
              <p className="text-center text-[15px] text-gray-400 dark:text-gray-500 py-12">Sem erros de impressão ou folhas em branco registrados para o período.</p>
            )}
          </div>
        );
      })()}

      {/* ── Top Student Modal ── */}
      <Modal open={!!selectedTop} onClose={() => setSelectedTop(null)} title="Histórico do Aluno" size="xl">
        {selectedTop && (
          <div className="space-y-4">
            <div className="flex gap-4">
              <Avatar photo={topPhoto} name={selectedTop.name} size="md" />
              <div>
                <p className="text-[16px] font-semibold text-gray-900 dark:text-white">{selectedTop.name}</p>
                <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-0.5">{selectedTop.registration_number}</p>
                <p className="text-[13px] text-gray-500 dark:text-gray-400">{selectedTop.course}{selectedTop.period && ` · ${selectedTop.period}`}</p>
                <p className="text-[13px] font-medium text-gray-700 dark:text-gray-200 mt-1">{selectedTop.total_sheets} folhas no período selecionado</p>
              </div>
            </div>
            {topModalLoading ? (
              <div className="flex justify-center py-8"><Spinner /></div>
            ) : topHistory.length === 0 ? (
              <p className="text-center text-[14px] text-gray-400 dark:text-gray-500 py-4">Nenhum registro encontrado.</p>
            ) : (() => {
              const totalPages = Math.max(1, Math.ceil(topHistory.length / TOP_HISTORY_PAGE_SIZE));
              const safePage = Math.min(topHistoryPage, totalPages);
              const paged = topHistory.slice((safePage - 1) * TOP_HISTORY_PAGE_SIZE, safePage * TOP_HISTORY_PAGE_SIZE);
              return (
                <div className="space-y-2">
                  <div className="rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
                    <table className="w-full text-[14px]">
                      <thead className="bg-gray-50/80 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800">
                        <tr><Th>Data</Th><Th>Tipo</Th><Th>Operador</Th><Th right>Folhas</Th></tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {paged.map(e => (
                          <tr key={e.id} className="hover:bg-gray-50/40 dark:hover:bg-gray-800/30">
                            <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">{formatDate(e.created_at)}</td>
                            <td className="px-4 py-2.5">
                              <span className={`text-[12px] font-medium px-2 py-0.5 rounded-full ${e.type === 'own' ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400' : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400'}`}>
                                {ENTRY_TYPE_LABELS[e.type]}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">{e.operator_login}</td>
                            <td className="px-4 py-2.5 text-right font-bold text-gray-900 dark:text-white">{e.sheets}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between pt-1">
                      <p className="text-[12px] text-gray-400 dark:text-gray-500">
                        {(safePage - 1) * TOP_HISTORY_PAGE_SIZE + 1}–{Math.min(safePage * TOP_HISTORY_PAGE_SIZE, topHistory.length)} de {topHistory.length}
                      </p>
                      <div className="flex gap-1">
                        <button
                          onClick={() => setTopHistoryPage(Math.max(1, safePage - 1))}
                          disabled={safePage === 1}
                          className="px-2.5 py-1 text-[12px] font-medium rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          Anterior
                        </button>
                        {Array.from({ length: totalPages }, (_, i) => i + 1)
                          .filter(p => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1)
                          .reduce<(number | '...')[]>((acc, p, idx, arr) => {
                            if (idx > 0 && (p as number) - (arr[idx - 1] as number) > 1) acc.push('...');
                            acc.push(p);
                            return acc;
                          }, [])
                          .map((p, idx) => p === '...'
                            ? <span key={`e${idx}`} className="px-1 text-[12px] text-gray-400 dark:text-gray-500">…</span>
                            : <button key={p} onClick={() => setTopHistoryPage(p as number)}
                                className={`w-7 h-7 text-[12px] font-medium rounded-lg transition-colors ${p === safePage ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900' : 'border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
                                {p}
                              </button>
                          )}
                        <button
                          onClick={() => setTopHistoryPage(Math.min(totalPages, safePage + 1))}
                          disabled={safePage === totalPages}
                          className="px-2.5 py-1 text-[12px] font-medium rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          Próxima
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </Modal>
    </div>
  );
}
