import { StackedDebit } from '../types';
import { User, AlertTriangle } from 'lucide-react';

interface StackPreviewProps {
  debits: StackedDebit[];
  totalSheets: number;
}

export function StackPreview({ debits, totalSheets }: StackPreviewProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 p-3.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl">
        <AlertTriangle size={17} className="text-amber-600 dark:text-amber-400 shrink-0" />
        <p className="text-[14px] text-amber-800 dark:text-amber-300 font-medium">
          Saldo insuficiente — débito distribuído em {debits.length} usuário{debits.length > 1 ? 's' : ''}.
          Total: <strong>{totalSheets} folhas</strong>.
        </p>
      </div>

      <div className="space-y-2">
        {debits.map((d, i) => (
          <div
            key={`${d.user_type ?? 'student'}-${d.user_id}`}
            className="flex items-center justify-between p-3.5 bg-white/70 dark:bg-gray-900/70 border border-gray-200 dark:border-gray-700 rounded-xl animate-fadeIn"
            style={{ animationDelay: `${i * 40}ms` }}
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                <User size={16} className="text-gray-500 dark:text-gray-400" />
              </div>
              <div>
                <p className="text-[14px] font-semibold text-gray-900 dark:text-white">{d.name}</p>
                <p className="text-[12px] text-gray-500 dark:text-gray-400">{d.identifier} · {d.available} disponíveis</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[16px] font-bold text-gray-900 dark:text-white">{d.sheets_to_debit}</p>
              <p className="text-[12px] text-gray-400 dark:text-gray-500">folhas</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-between items-center pt-2 border-t border-gray-100 dark:border-gray-800">
        <span className="text-[14px] text-gray-500 dark:text-gray-400 font-medium">Total debitado</span>
        <span className="text-[16px] font-bold text-gray-900 dark:text-white">
          {debits.reduce((s, d) => s + d.sheets_to_debit, 0)} folhas
        </span>
      </div>
    </div>
  );
}
