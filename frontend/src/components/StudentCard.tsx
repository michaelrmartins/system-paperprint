import { IdentifyResult } from '../types';
import { AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import { SYNC_STATUS_LABELS } from '../lib/format';

interface StudentCardProps {
  result: IdentifyResult;
  compact?: boolean;
}

export function StudentCard({ result, compact = false }: StudentCardProps) {
  const { student, photo, available_balance, daily_consumed } = result;

  const balanceColor =
    available_balance === 0
      ? 'text-red-600'
      : available_balance <= 3
      ? 'text-amber-600'
      : 'text-emerald-600';

  return (
    <div className={`flex gap-4 ${compact ? '' : 'p-4 bg-white/60 backdrop-blur-sm border border-white/60 rounded-2xl shadow-glass-sm animate-fadeIn'}`}>
      <div className="shrink-0">
        {photo ? (
          <img
            src={`data:image/jpeg;base64,${photo}`}
            alt={student.name}
            className="w-16 h-16 rounded-xl object-cover border border-white/60 shadow-sm"
          />
        ) : (
          <div className="w-16 h-16 rounded-xl bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-400 text-xl font-semibold">
            {student.name.charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[15px] font-semibold text-gray-900 leading-tight truncate">{student.name}</p>
            <p className="text-[12px] text-gray-500 mt-0.5">{student.registration_number}</p>
          </div>
          {student.sync_status !== 'synced' && (
            <span className="shrink-0 flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
              <AlertCircle size={11} />
              {SYNC_STATUS_LABELS[student.sync_status]}
            </span>
          )}
        </div>

        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {student.course && (
            <span className="text-[12px] text-gray-600">{student.course}</span>
          )}
          {student.period && (
            <span className="text-[12px] text-gray-500">{student.period}</span>
          )}
        </div>

        <div className="mt-3 flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <Clock size={13} className="text-gray-400" />
            <span className="text-[12px] text-gray-500">
              <span className="font-semibold text-gray-700">{daily_consumed}</span> impressas hoje
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {available_balance > 0
              ? <CheckCircle2 size={13} className={balanceColor} />
              : <AlertCircle size={13} className={balanceColor} />
            }
            <span className={`text-[12px] font-semibold ${balanceColor}`}>
              {available_balance} disponíveis
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
