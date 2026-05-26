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
    <div className={`flex gap-4 ${compact ? '' : 'p-4 bg-white/60 backdrop-blur-sm border border-white/60 rounded-2xl shadow-glass-sm animate-fadeIn'}`}>
      <div className="shrink-0">
        {photo ? (
          <img
            src={`data:image/jpeg;base64,${photo}`}
            alt={user.name}
            className="w-16 h-16 rounded-xl object-cover border border-white/60 shadow-sm"
          />
        ) : (
          <div className={`w-16 h-16 rounded-xl border flex items-center justify-center text-xl font-semibold ${
            isEmployee
              ? 'bg-blue-50 border-blue-100 text-blue-400'
              : 'bg-gray-100 border-gray-200 text-gray-400'
          }`}>
            {isEmployee
              ? <Briefcase size={24} />
              : user.name.charAt(0).toUpperCase()
            }
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-1.5">
              <p className="text-[15px] font-semibold text-gray-900 leading-tight truncate">{user.name}</p>
              {isEmployee && (
                <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100">
                  Funcionário
                </span>
              )}
            </div>
            <p className="text-[12px] text-gray-500 mt-0.5">{identifier}</p>
          </div>
          {user.sync_status !== 'synced' && (
            <span className="shrink-0 flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
              <AlertCircle size={11} />
              {SYNC_STATUS_LABELS[user.sync_status]}
            </span>
          )}
        </div>

        {detail && (
          <div className="mt-1.5">
            <span className="text-[12px] text-gray-600">{detail}</span>
          </div>
        )}

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
