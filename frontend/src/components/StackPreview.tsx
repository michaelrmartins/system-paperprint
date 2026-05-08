import { StackedDebit } from '../types';
import { User, AlertTriangle } from 'lucide-react';

interface StackPreviewProps {
  debits: StackedDebit[];
  totalSheets: number;
}

export function StackPreview({ debits, totalSheets }: StackPreviewProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
        <AlertTriangle size={15} className="text-amber-600 shrink-0" />
        <p className="text-[13px] text-amber-800 font-medium">
          Saldo insuficiente — débito distribuído em {debits.length} matrícula{debits.length > 1 ? 's' : ''}.
          Total: <strong>{totalSheets} folhas</strong>.
        </p>
      </div>

      <div className="space-y-2">
        {debits.map((d, i) => (
          <div
            key={d.student_id}
            className="flex items-center justify-between p-3 bg-white/70 border border-gray-200 rounded-xl animate-fadeIn"
            style={{ animationDelay: `${i * 40}ms` }}
          >
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center">
                <User size={14} className="text-gray-500" />
              </div>
              <div>
                <p className="text-[13px] font-semibold text-gray-900">{d.name}</p>
                <p className="text-[11px] text-gray-500">{d.registration_number} · {d.available} disponíveis</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[15px] font-bold text-gray-900">{d.sheets_to_debit}</p>
              <p className="text-[11px] text-gray-400">folhas</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-between items-center pt-2 border-t border-gray-100">
        <span className="text-[13px] text-gray-500 font-medium">Total debitado</span>
        <span className="text-[15px] font-bold text-gray-900">
          {debits.reduce((s, d) => s + d.sheets_to_debit, 0)} folhas
        </span>
      </div>
    </div>
  );
}
