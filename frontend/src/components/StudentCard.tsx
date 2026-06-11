import { IdentifyResult, getUserIdentifier, getUserDetail } from '../types';
import { AlertCircle, CheckCircle2, Clock, Briefcase } from 'lucide-react';
import { SYNC_STATUS_LABELS } from '../lib/format';

interface StudentCardProps {
  result: IdentifyResult;
  compact?: boolean;
}

export function StudentCard({ result, compact = false }: StudentCardProps) {
  const { user, user_type, photo, available_balance, daily_consumed } = result;

  const identifier = getUserIdentifier(user, user_type);
  const detail = getUserDetail(user, user_type);

  const balanceColor =
    available_balance === 0
      ? 'text-red-600'
      : available_balance <= 3
      ? 'text-amber-600'
      : 'text-emerald-600';

  const isEmployee = user_type === 'employee';

  return (
    <div className={`flex gap-4 ${compact ? '' : 'p-4 bg-white/60 dark:bg-gray-900/60 backdrop-blur-sm border border-white/60 dark:border-white/10 rounded-2xl shadow-glass-sm animate-fadeIn'}`}>
      <div className="shrink-0">
        {photo ? (
          <img
            src={`data:image/jpeg;base64,${photo}`}
            alt={user.name}
            className="w-16 h-16 rounded-xl object-cover border border-white/60 dark:border-white/10 shadow-sm"
          />
        ) : (
          <div className={`w-16 h-16 rounded-xl border flex items-center justify-center text-xl font-semibold ${
            isEmployee
              ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-100 dark:border-blue-900 text-blue-400'
              : 'bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500'
          }`}>
            {isEmployee
              ? <Briefcase size={26} />
              : user.name.charAt(0).toUpperCase()
            }
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-1.5">
              <p className="text-[16px] font-semibold text-gray-900 dark:text-white leading-tight truncate">{user.name}</p>
              {isEmployee && (
                <span className="shrink-0 text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-900">
                  Funcionário
                </span>
              )}
            </div>
            <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-0.5">{identifier}</p>
          </div>
          {user.sync_status !== 'synced' && (
            <span className="shrink-0 flex items-center gap-1 text-[12px] font-medium px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
              <AlertCircle size={12} />
              {SYNC_STATUS_LABELS[user.sync_status]}
            </span>
          )}
        </div>

        {detail && (
          <div className="mt-1.5">
            <span className="text-[13px] text-gray-600 dark:text-gray-300">{detail}</span>
          </div>
        )}

        <div className="mt-3 flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <Clock size={15} className="text-gray-400 dark:text-gray-500" />
            <span className="text-[13px] text-gray-500 dark:text-gray-400">
              <span className="font-semibold text-gray-700 dark:text-gray-200">{daily_consumed}</span> impressas hoje
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {available_balance > 0
              ? <CheckCircle2 size={15} className={balanceColor} />
              : <AlertCircle size={15} className={balanceColor} />
            }
            <span className={`text-[13px] font-semibold ${balanceColor}`}>
              {available_balance} disponíveis
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
