import { useState, useEffect, useCallback, useRef } from 'react';
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

// Slot-machine roll-up for a single character when its value changes
function SlotDigit({ char }: { char: string }) {
  const [animState, setAnimState] = useState({ key: 0, from: char, to: char });
  const prevRef = useRef(char);

  useEffect(() => {
    if (char !== prevRef.current) {
      const from = prevRef.current;
      prevRef.current = char;
      setAnimState(s => ({ key: s.key + 1, from, to: char }));
    }
  }, [char]);

  const animating = animState.key > 0;
  const topChar = animating ? animState.from : char;
  const bottomChar = animating ? animState.to : char;

  return (
    <span
      style={{
        display: 'inline-block',
        overflow: 'hidden',
        height: '1em',
        lineHeight: 1,
        verticalAlign: '-0.1em',
      }}
    >
      <span
        key={animState.key}
        style={{
          display: 'block',
          animation: animating ? 'slot-roll-up 0.4s cubic-bezier(0.22, 1, 0.36, 1) forwards' : undefined,
        }}
      >
        <span style={{ display: 'block', height: '1em', lineHeight: 1 }}>{topChar}</span>
        <span style={{ display: 'block', height: '1em', lineHeight: 1 }}>{bottomChar}</span>
      </span>
    </span>
  );
}

function SlotNumber({ value }: { value: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', fontVariantNumeric: 'tabular-nums' }}>
      {Array.from(value).map((char, i) => (
        <SlotDigit key={i} char={char} />
      ))}
    </span>
  );
}

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

type Increment = { value: number; visible: boolean; key: number };
const INCREMENT_HIDE_MS = 30_000;
const INCREMENT_FADE_MS = 400;

export function PrinterWidget() {
  const [data, setData] = useState<PrinterData | null>(null);
  const [increment, setIncrement] = useState<Increment | null>(null);
  const prevPagesNumRef = useRef<number | null>(null);
  const incrementKeyRef = useRef(0);
  const fadeTimerRef = useRef<number | null>(null);
  const removeTimerRef = useRef<number | null>(null);

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

  useEffect(() => {
    if (data?.pages == null) return;
    const num = parseInt(data.pages.replace(/\D/g, ''), 10);
    if (Number.isNaN(num)) return;

    const prev = prevPagesNumRef.current;
    prevPagesNumRef.current = num;

    if (prev != null && num > prev) {
      const delta = num - prev;
      incrementKeyRef.current += 1;
      const key = incrementKeyRef.current;

      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
      if (removeTimerRef.current) clearTimeout(removeTimerRef.current);

      setIncrement({ value: delta, visible: true, key });

      fadeTimerRef.current = window.setTimeout(() => {
        setIncrement(curr => (curr ? { ...curr, visible: false } : null));
      }, INCREMENT_HIDE_MS);

      removeTimerRef.current = window.setTimeout(() => {
        setIncrement(null);
      }, INCREMENT_HIDE_MS + INCREMENT_FADE_MS);
    }
  }, [data?.pages]);

  useEffect(() => () => {
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    if (removeTimerRef.current) clearTimeout(removeTimerRef.current);
  }, []);

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
          <span className="text-[12px] font-semibold text-gray-700 dark:text-gray-300">
            <SlotNumber value={data.pages} />
            {increment && (
              <span
                key={increment.key}
                className="ml-1.5 text-[10px] font-semibold text-emerald-500 dark:text-emerald-400"
                style={{
                  display: 'inline-block',
                  opacity: increment.visible ? 1 : 0,
                  transition: `opacity ${INCREMENT_FADE_MS}ms ease-out`,
                  animation: increment.visible
                    ? `badge-pop ${INCREMENT_FADE_MS}ms cubic-bezier(0.22, 1, 0.36, 1) both`
                    : 'none',
                }}
              >
                +{increment.value}
              </span>
            )}
          </span>
        </div>
      )}

      {data.toner != null && <TonerBar value={data.toner} />}
    </div>
  );
}
