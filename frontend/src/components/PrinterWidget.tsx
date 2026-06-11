import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';

interface PrinterData {
  configured: boolean;
  hostname?: string;
  online?: boolean;
  model?: string | null;
  pages?: string | null;
  toner?: number | null;
}

const POLL_MS = 30_000;

function tonerColor(pct: number) {
  if (pct < 15) return { bar: 'bg-red-500',    text: 'text-red-500' };
  if (pct < 30) return { bar: 'bg-amber-400',  text: 'text-amber-500' };
  return              { bar: 'bg-gray-800 dark:bg-gray-300',    text: 'text-gray-600 dark:text-gray-400' };
}

function TonerBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  const { bar, text } = tonerColor(pct);
  return (
    <div className="mt-1.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-gray-400 dark:text-gray-500">Toner</span>
        <span className={`text-[11px] font-medium ${text}`}>{Math.round(pct)}%</span>
      </div>
      <div className="h-[3px] w-full bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${bar}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function PrinterWidget() {
  const [data, setData] = useState<PrinterData | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await api.get<PrinterData>('/zabbix/printer-data');
      setData(res.data);
    } catch {
      // silent — widget just doesn't update
    }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, POLL_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  if (!data || !data.configured) return null;

  return (
    <div className="mt-4 p-3 bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm border border-white/60 dark:border-white/10 rounded-xl shadow-sm">
      <div className="flex items-center gap-1.5 mb-2">
        <span
          className={`shrink-0 w-2 h-2 rounded-full ${data.online ? 'bg-emerald-500' : 'bg-red-400'}`}
          title={data.online ? 'Online' : 'Offline'}
        />
        <p className="text-[12px] font-semibold text-gray-800 dark:text-gray-200 truncate" title={data.hostname}>
          {data.hostname}
        </p>
      </div>

      {data.model && (
        <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate mb-1" title={data.model}>
          {data.model}
        </p>
      )}

      {data.pages != null && (
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] text-gray-400 dark:text-gray-500">Páginas</span>
          <span className="text-[12px] font-semibold text-gray-700 dark:text-gray-300">{data.pages}</span>
        </div>
      )}

      {data.toner != null && <TonerBar value={data.toner} />}
    </div>
  );
}
