import { useState, useEffect } from 'react';
import api from '../lib/api';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Modal } from '../components/Modal';
import { Spinner } from '../components/Spinner';
import { extractApiError } from '../lib/errors';
import { Search } from 'lucide-react';
import { PrintEntry, PrintOperation } from '../types';
import { formatDate, ENTRY_TYPE_LABELS, STATUS_LABELS } from '../lib/format';

interface OperationWithEntries {
  operation: PrintOperation;
  entries: PrintEntry[];
}

export function AdjustEntryPage() {
  const [operationId, setOperationId] = useState('');
  const [loadingOp, setLoadingOp] = useState(false);
  const [operations, setOperations] = useState<OperationWithEntries[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [searchError, setSearchError] = useState('');

  const [adjustEntry, setAdjustEntry] = useState<PrintEntry | null>(null);
  const [newSheets, setNewSheets] = useState('');
  const [reason, setReason] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const [adjustError, setAdjustError] = useState('');
  const [confirmAdjust, setConfirmAdjust] = useState(false);

  // Load last 10 operations on mount
  useEffect(() => {
    api.get<{ operations: Array<PrintOperation & { entries: PrintEntry[] }> }>('/print/operations/recent')
      .then((r) => {
        setOperations(r.data.operations.map((op) => ({
          operation: op,
          entries: op.entries,
        })));
      })
      .finally(() => setLoadingRecent(false));
  }, []);

  const searchOperation = async () => {
    const id = operationId.trim();
    if (!id) return;
    setLoadingOp(true);
    setSearchError('');
    try {
      const res = await api.get<{ operation: PrintOperation; entries: PrintEntry[] }>(
        `/print/operations/${id}`
      );
      // Put searched operation at top, dedup
      setOperations((prev) => {
        const filtered = prev.filter((o) => o.operation.id !== res.data.operation.id);
        return [{ operation: res.data.operation, entries: res.data.entries }, ...filtered];
      });
      setOperationId('');
    } catch (err) {
      setSearchError(extractApiError(err));
    } finally {
      setLoadingOp(false);
    }
  };

  const updateEntryInState = (entryId: number, newSheetsVal: number) => {
    setOperations((prev) =>
      prev.map((o) => ({
        ...o,
        entries: o.entries.map((e) => e.id === entryId ? { ...e, sheets: newSheetsVal } : e),
      }))
    );
  };

  const submitAdjust = async () => {
    if (!adjustEntry) return;
    setAdjusting(true);
    setAdjustError('');
    try {
      await api.patch(`/print/entries/${adjustEntry.id}`, {
        sheets: parseInt(newSheets),
        reason: reason.trim(),
      });
      updateEntryInState(adjustEntry.id, parseInt(newSheets));
      setAdjustEntry(null);
      setNewSheets('');
      setReason('');
      setConfirmAdjust(false);
    } catch (err) {
      setAdjustError(extractApiError(err));
    } finally {
      setAdjusting(false);
    }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <h1 className="text-[18px] font-semibold text-gray-900">Ajuste de Lançamento</h1>

      {/* Search */}
      <div className="bg-white/70 backdrop-blur-xl border border-white/60 rounded-2xl shadow-glass p-5">
        <p className="text-[13px] text-gray-500 mb-3">
          Busque por ID ou navegue pelas últimas operações abaixo. Todo ajuste é registrado em auditoria.
        </p>
        <div className="flex gap-2">
          <Input
            placeholder="ID da operação"
            value={operationId}
            onChange={(e) => setOperationId(e.target.value.replace(/[^0-9]/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && searchOperation()}
            className="flex-1"
          />
          <Button onClick={searchOperation} loading={loadingOp} size="sm" variant="secondary">
            <Search size={14} /> Buscar
          </Button>
        </div>
        {searchError && <p className="text-[13px] text-red-500 mt-2">{searchError}</p>}
      </div>

      {/* Operations list */}
      {loadingRecent ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : operations.length === 0 ? (
        <p className="text-center text-[14px] text-gray-400 py-8">Nenhuma operação registrada.</p>
      ) : (
        <div className="space-y-3">
          {operations.map((o) => (
            <div
              key={o.operation.id}
              className="bg-white/70 backdrop-blur-xl border border-white/60 rounded-2xl shadow-glass overflow-hidden animate-fadeIn"
            >
              {/* Operation header */}
              <div className="px-5 py-3.5 border-b border-gray-100 bg-gray-50/60 flex items-center justify-between">
                <div>
                  <p className="text-[13px] font-semibold text-gray-900">
                    Operação #{o.operation.id}
                    <span className="ml-2 font-normal text-gray-500">·</span>
                    <span className="ml-2 font-normal text-gray-700">{o.operation.student_name}</span>
                  </p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {o.operation.registration_number} · op. por {o.operation.operator_login} · {formatDate(o.operation.created_at)}
                  </p>
                </div>
                <span className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full ${
                  o.operation.status === 'completed' ? 'bg-emerald-50 text-emerald-700' :
                  o.operation.status === 'contingency' ? 'bg-blue-50 text-blue-700' :
                  'bg-amber-50 text-amber-700'
                }`}>
                  {STATUS_LABELS[o.operation.status]}
                </span>
              </div>

              {/* Entries */}
              <div className="divide-y divide-gray-100/80">
                {o.entries.map((e) => (
                  <div key={e.id} className="flex items-center justify-between px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                        e.type === 'own'
                          ? 'bg-blue-50 text-blue-700'
                          : 'bg-amber-50 text-amber-700'
                      }`}>
                        {ENTRY_TYPE_LABELS[e.type]}
                      </span>
                      <span className="text-[13px] text-gray-700">{e.student_name || o.operation.student_name}</span>
                      {e.registration_number && e.registration_number !== o.operation.registration_number && (
                        <span className="text-[11px] text-gray-400">({e.registration_number})</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-[15px] font-bold text-gray-900">{e.sheets} folhas</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { setAdjustEntry(e); setNewSheets(String(e.sheets)); setReason(''); setAdjustError(''); }}
                      >
                        Ajustar
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Adjust modal step 1 */}
      <Modal
        open={!!adjustEntry && !confirmAdjust}
        onClose={() => setAdjustEntry(null)}
        title="Ajustar Lançamento"
        size="sm"
      >
        <p className="text-[13px] text-gray-500 mb-4">
          Lançamento #{adjustEntry?.id} · {adjustEntry?.student_name} · atual: <strong>{adjustEntry?.sheets} folhas</strong>
        </p>
        <div className="space-y-3">
          <Input
            label="Novo valor (folhas)"
            type="number"
            min="0"
            step="1"
            value={newSheets}
            onChange={(e) => setNewSheets(e.target.value.replace(/[^0-9]/g, ''))}
            autoFocus
          />
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-gray-500 uppercase tracking-wide">Motivo (obrigatório)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Descreva o motivo do ajuste..."
              className="w-full px-3 py-2 text-[14px] border border-gray-200 rounded-xl outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-200 resize-none"
            />
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <Button variant="secondary" size="sm" onClick={() => setAdjustEntry(null)}>Cancelar</Button>
          <Button
            onClick={() => setConfirmAdjust(true)}
            disabled={newSheets === '' || !reason.trim()}
            className="flex-1 justify-center"
            size="sm"
          >
            Avançar
          </Button>
        </div>
      </Modal>

      {/* Confirm modal step 2 */}
      <Modal
        open={confirmAdjust}
        onClose={() => setConfirmAdjust(false)}
        title="Confirmar Ajuste"
        size="sm"
      >
        <div className="space-y-2 mb-4">
          <div className="flex justify-between text-[13px]">
            <span className="text-gray-500">Lançamento</span>
            <span className="font-medium">#{adjustEntry?.id}</span>
          </div>
          <div className="flex justify-between text-[13px]">
            <span className="text-gray-500">Aluno</span>
            <span className="font-medium">{adjustEntry?.student_name}</span>
          </div>
          <div className="flex justify-between text-[13px]">
            <span className="text-gray-500">Alteração</span>
            <span>
              <span className="line-through text-gray-400">{adjustEntry?.sheets}</span>
              {' '}&rarr;{' '}
              <strong>{newSheets} folhas</strong>
            </span>
          </div>
          <div className="pt-2 border-t border-gray-100">
            <p className="text-[12px] text-gray-500">Motivo:</p>
            <p className="text-[13px] text-gray-700 italic mt-0.5">"{reason}"</p>
          </div>
        </div>
        {adjustError && <p className="text-[13px] text-red-500 mb-3">{adjustError}</p>}
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setConfirmAdjust(false)}>Voltar</Button>
          <Button
            onClick={submitAdjust}
            loading={adjusting}
            className="flex-1 justify-center"
            size="sm"
          >
            Confirmar ajuste
          </Button>
        </div>
      </Modal>
    </div>
  );
}
