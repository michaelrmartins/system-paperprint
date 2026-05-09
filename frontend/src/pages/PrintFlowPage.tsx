import { useState, useRef, useCallback, useEffect } from 'react';
import { CreditCard, Keyboard, Camera, ChevronRight, Plus, Trash2, RefreshCw } from 'lucide-react';
import api from '../lib/api';
import { IdentifyResult, StackedDebit } from '../types';
import { StudentCard } from '../components/StudentCard';
import { StackPreview } from '../components/StackPreview';
import { Modal } from '../components/Modal';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Spinner } from '../components/Spinner';
import { extractApiError } from '../lib/errors';

type Step = 'identify' | 'sheets' | 'stack' | 'confirm' | 'done';
type IdentifyMethod = 'manual' | 'rfid' | 'facial';

interface LoanStudent {
  identify_result: IdentifyResult;
  identify_method: IdentifyMethod;
}

function onlyNumbers(value: string): string {
  return value.replace(/\D/g, '');
}

function getNotInLyceumReg(err: unknown): string | null {
  const data = (err as { response?: { data?: { error?: string; registration_number?: string } } })?.response?.data;
  if (data?.error === 'STUDENT_NOT_IN_LYCEUM') return data.registration_number ?? '';
  return null;
}

export function PrintFlowPage() {
  const [step, setStep] = useState<Step>('identify');
  const [identifyMethod, setIdentifyMethod] = useState<IdentifyMethod>('manual');
  const [identifyMethodUsed, setIdentifyMethodUsed] = useState<IdentifyMethod>('manual');
  const [registration, setRegistration] = useState('');
  const [cardHex, setCardHex] = useState('');
  const [identifying, setIdentifying] = useState(false);
  const [identifyResult, setIdentifyResult] = useState<IdentifyResult | null>(null);
  const [identifyError, setIdentifyError] = useState('');

  const [sheets, setSheets] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [debits, setDebits] = useState<StackedDebit[]>([]);
  const [loanStudents, setLoanStudents] = useState<LoanStudent[]>([]);
  const [stackError, setStackError] = useState('');

  const [confirmLoading, setConfirmLoading] = useState(false);
  const [doneOperationId, setDoneOperationId] = useState<number | null>(null);
  const [errorModal, setErrorModal] = useState('');
  const [notInLyceumModal, setNotInLyceumModal] = useState<{ registration_number: string; confirm: () => void } | null>(null);

  const [addingLoan, setAddingLoan] = useState(false);
  const [loanIdentifyMethod, setLoanIdentifyMethod] = useState<IdentifyMethod>('manual');
  const [loanRegistration, setLoanRegistration] = useState('');
  const [loanCardHex, setLoanCardHex] = useState('');
  const [loanLoading, setLoanLoading] = useState(false);
  const [loanError, setLoanError] = useState('');
  const [loanAddedMsg, setLoanAddedMsg] = useState('');

  // Camera state
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const [cameraActive, setCameraActive] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const registrationInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => { streamRef.current?.getTracks().forEach((t) => t.stop()); };
  }, []);

  useEffect(() => {
    if (step === 'identify' && identifyMethod === 'manual') {
      registrationInputRef.current?.focus();
    }
  }, [step, identifyMethod]);

  const enumerateCameras = useCallback(async () => {
    try {
      // Ask for permission once so labels are populated
      const probe = await navigator.mediaDevices.getUserMedia({ video: true });
      probe.getTracks().forEach((t) => t.stop());
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((d) => d.kind === 'videoinput');
      setCameras(videoInputs);
      if (videoInputs.length > 0) {
        setSelectedCameraId((prev) => prev || videoInputs[0].deviceId);
      }
    } catch {
      setIdentifyError('Câmera não disponível. Use outro método de identificação.');
    }
  }, []);

  useEffect(() => {
    if (identifyMethod === 'facial') {
      enumerateCameras();
    }
  }, [identifyMethod, enumerateCameras]);

  useEffect(() => {
    if (addingLoan && loanIdentifyMethod === 'facial') {
      enumerateCameras();
    }
  }, [addingLoan, loanIdentifyMethod, enumerateCameras]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraActive(false);
  }, []);

  const startCamera = useCallback(async () => {
    try {
      stopCamera();
      const constraints: MediaStreamConstraints = {
        video: selectedCameraId
          ? { deviceId: { exact: selectedCameraId } }
          : { facingMode: 'user' },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraActive(true);
    } catch {
      setIdentifyError('Não foi possível acessar a câmera selecionada.');
    }
  }, [selectedCameraId, stopCamera]);

  // Restart camera when selected device changes
  useEffect(() => {
    if (cameraActive && selectedCameraId) {
      startCamera();
    }
  }, [selectedCameraId]); // eslint-disable-line react-hooks/exhaustive-deps

  const captureAndRecognize = useCallback(async (force = false) => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext('2d')!.drawImage(videoRef.current, 0, 0);
    const image = canvas.toDataURL('image/jpeg', 0.8);

    setIdentifying(true);
    setIdentifyError('');
    try {
      const res = await api.post<IdentifyResult>(
        '/students/identify/facial',
        { image },
        force ? { params: { force: 'true' } } : undefined,
      );
      stopCamera();
      setIdentifyResult(res.data);
      setIdentifyMethodUsed('facial');
      setStep('sheets');
    } catch (err) {
      const reg = getNotInLyceumReg(err);
      if (reg !== null) {
        setNotInLyceumModal({ registration_number: reg, confirm: () => captureAndRecognize(true) });
        return;
      }
      setIdentifyError(extractApiError(err));
    } finally {
      setIdentifying(false);
    }
  }, [stopCamera]); // eslint-disable-line react-hooks/exhaustive-deps

  const identifyByManual = async (force = false) => {
    if (!registration.trim()) return;
    setIdentifying(true);
    setIdentifyError('');
    try {
      const res = await api.post<IdentifyResult>(
        '/students/identify/manual',
        { registration_number: registration.trim() },
        force ? { params: { force: 'true' } } : undefined,
      );
      setIdentifyResult(res.data);
      setIdentifyMethodUsed('manual');
      setStep('sheets');
    } catch (err) {
      const reg = getNotInLyceumReg(err);
      if (reg !== null) {
        setNotInLyceumModal({ registration_number: reg, confirm: () => identifyByManual(true) });
        return;
      }
      setIdentifyError(extractApiError(err));
    } finally {
      setIdentifying(false);
    }
  };

  const identifyByRFID = async (hex: string, force = false) => {
    setIdentifying(true);
    setIdentifyError('');
    try {
      const res = await api.post<IdentifyResult>(
        '/students/identify/rfid',
        { card_hex: hex },
        force ? { params: { force: 'true' } } : undefined,
      );
      setIdentifyResult(res.data);
      setIdentifyMethodUsed('rfid');
      setStep('sheets');
    } catch (err) {
      const reg = getNotInLyceumReg(err);
      if (reg !== null) {
        setNotInLyceumModal({ registration_number: reg, confirm: () => identifyByRFID(hex, true) });
        return;
      }
      setIdentifyError(extractApiError(err));
    } finally {
      setIdentifying(false);
      if (!force) setCardHex('');
    }
  };

  const handleSheetsNext = async () => {
    const n = parseInt(sheets);
    if (!n || n <= 0 || !identifyResult) return;

    setPreviewLoading(true);
    setStackError('');
    try {
      const extraIds = loanStudents.map((l) => l.identify_result.student.id);
      const res = await api.post<{ debits: StackedDebit[] }>('/print/preview-stack', {
        primary_student_id: identifyResult.student.id,
        total_sheets: n,
        extra_student_ids: extraIds,
      });
      setDebits(res.data.debits);
      setStep(res.data.debits.length > 1 ? 'stack' : 'confirm');
    } catch (err) {
      setStackError(extractApiError(err));
    } finally {
      setPreviewLoading(false);
    }
  };

  const closeLoanModal = () => {
    setAddingLoan(false);
    setLoanRegistration('');
    setLoanCardHex('');
    setLoanIdentifyMethod('manual');
    setLoanError('');
    setLoanAddedMsg('');
    stopCamera();
  };

  const switchLoanMethod = (method: IdentifyMethod) => {
    setLoanIdentifyMethod(method);
    setLoanError('');
    setLoanAddedMsg('');
    if (method !== 'facial') stopCamera();
  };

  const validateAndAddLoanStudent = (result: IdentifyResult, method: IdentifyMethod): boolean => {
    if (result.student.id === identifyResult?.student.id) {
      setErrorModal('O emprestador não pode ser o próprio solicitante da impressão.');
      return false;
    }
    if (loanStudents.some((l) => l.identify_result.student.id === result.student.id)) {
      setErrorModal('Esta matrícula já foi adicionada como emprestadora.');
      return false;
    }

    const newLoanStudents = [...loanStudents, { identify_result: result, identify_method: method }];
    setLoanStudents(newLoanStudents);

    const sheetsNeeded = parseInt(sheets) || 0;
    const primaryBalance = identifyResult?.available_balance ?? 0;
    const totalAvailable = primaryBalance + newLoanStudents.reduce((sum, l) => sum + l.identify_result.available_balance, 0);
    const remaining = sheetsNeeded > 0 ? Math.max(0, sheetsNeeded - totalAvailable) : 0;

    if (remaining > 0) {
      setLoanRegistration('');
      setLoanCardHex('');
      setLoanError('');
      stopCamera();
      setLoanAddedMsg(
        `✓ ${result.student.name} adicionado (+${result.available_balance} folha${result.available_balance !== 1 ? 's' : ''}). Ainda faltam ${remaining} folha${remaining !== 1 ? 's' : ''}.`
      );
      return true;
    }

    closeLoanModal();
    return true;
  };

  const addLoanByManual = async (force = false) => {
    if (!loanRegistration.trim()) return;
    setLoanLoading(true);
    try {
      const res = await api.post<IdentifyResult>(
        '/students/identify/manual',
        { registration_number: loanRegistration.trim() },
        force ? { params: { force: 'true' } } : undefined,
      );
      validateAndAddLoanStudent(res.data, 'manual');
    } catch (err) {
      const reg = getNotInLyceumReg(err);
      if (reg !== null) {
        setNotInLyceumModal({ registration_number: reg, confirm: () => addLoanByManual(true) });
        return;
      }
      setErrorModal(extractApiError(err));
    } finally {
      setLoanLoading(false);
    }
  };

  const addLoanByRFID = async (force = false) => {
    if (!loanCardHex.trim()) return;
    setLoanLoading(true);
    try {
      const res = await api.post<IdentifyResult>(
        '/students/identify/rfid',
        { card_hex: loanCardHex.trim() },
        force ? { params: { force: 'true' } } : undefined,
      );
      validateAndAddLoanStudent(res.data, 'rfid');
    } catch (err) {
      const reg = getNotInLyceumReg(err);
      if (reg !== null) {
        setNotInLyceumModal({ registration_number: reg, confirm: () => addLoanByRFID(true) });
        return;
      }
      setErrorModal(extractApiError(err));
    } finally {
      setLoanLoading(false);
      if (!force) setLoanCardHex('');
    }
  };

  const addLoanByFacial = async (force = false) => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext('2d')!.drawImage(videoRef.current, 0, 0);
    const image = canvas.toDataURL('image/jpeg', 0.8);
    setLoanLoading(true);
    try {
      const res = await api.post<IdentifyResult>(
        '/students/identify/facial',
        { image },
        force ? { params: { force: 'true' } } : undefined,
      );
      validateAndAddLoanStudent(res.data, 'facial');
    } catch (err) {
      const reg = getNotInLyceumReg(err);
      if (reg !== null) {
        setNotInLyceumModal({ registration_number: reg, confirm: () => addLoanByFacial(true) });
        return;
      }
      setErrorModal(extractApiError(err));
    } finally {
      setLoanLoading(false);
    }
  };

  const confirmPrint = async () => {
    if (!identifyResult) return;
    setConfirmLoading(true);
    try {
      const enrichedDebits = debits.map((d) => {
        if (d.student_id === identifyResult.student.id) {
          return { ...d, identify_method: identifyMethodUsed };
        }
        const loan = loanStudents.find((l) => l.identify_result.student.id === d.student_id);
        return { ...d, identify_method: loan?.identify_method ?? 'manual' };
      });
      const res = await api.post<{ operation_id: number }>('/print/register', {
        primary_student_id: identifyResult.student.id,
        total_sheets: parseInt(sheets),
        stacked_debits: enrichedDebits,
        identify_method: identifyMethodUsed,
      });
      setDoneOperationId(res.data.operation_id);
      setStep('done');
    } catch (err) {
      setErrorModal(extractApiError(err));
    } finally {
      setConfirmLoading(false);
    }
  };

  const reset = () => {
    setStep('identify');
    setRegistration('');
    setCardHex('');
    setIdentifyResult(null);
    setIdentifyError('');
    setIdentifyMethodUsed('manual');
    setSheets('');
    setDebits([]);
    setLoanStudents([]);
    setStackError('');
    setDoneOperationId(null);
    stopCamera();
  };

  const switchMethod = (method: IdentifyMethod) => {
    setIdentifyMethod(method);
    setIdentifyError('');
    stopCamera();
  };

  return (
    <div className="max-w-lg mx-auto space-y-4">
      {/* ── Step: Identify ── */}
      {step === 'identify' && (
        <div className="bg-white/70 backdrop-blur-xl border border-white/60 rounded-2xl shadow-glass p-6 animate-slideUp">
          <h2 className="text-[16px] font-semibold text-gray-900 mb-5">Identificar Aluno</h2>

          {/* Method tabs */}
          <div className="flex gap-1 p-1 bg-gray-100/80 rounded-xl mb-5">
            {([
              { key: 'manual', icon: <Keyboard size={14} />, label: 'Matrícula' },
              { key: 'rfid',   icon: <CreditCard size={14} />, label: 'Carteirinha' },
              { key: 'facial', icon: <Camera size={14} />, label: 'Facial' },
            ] as const).map((m) => (
              <button
                key={m.key}
                onClick={() => switchMethod(m.key)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[13px] font-medium transition-all duration-150 ${
                  identifyMethod === m.key
                    ? 'bg-white shadow-sm text-gray-900'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {m.icon}
                {m.label}
              </button>
            ))}
          </div>

          {/* Manual */}
          {identifyMethod === 'manual' && (
            <div className="space-y-3">
              <Input
                ref={registrationInputRef}
                label="Matrícula"
                value={registration}
                onChange={(e) => setRegistration(onlyNumbers(e.target.value))}
                onKeyDown={(e) => e.key === 'Enter' && identifyByManual()}
                placeholder="Somente números"
                inputMode="numeric"
                pattern="[0-9]*"
              />
              <Button onClick={() => identifyByManual()} loading={identifying} className="w-full justify-center">
                Identificar <ChevronRight size={15} />
              </Button>
            </div>
          )}

          {/* RFID */}
          {identifyMethod === 'rfid' && (
            <div className="space-y-3">
              <div className="flex items-center justify-center h-24 rounded-xl bg-gray-50 border-2 border-dashed border-gray-200">
                <div className="text-center">
                  <CreditCard size={28} className="text-gray-300 mx-auto mb-1" />
                  <p className="text-[13px] text-gray-400">Aproxime o cartão ao leitor</p>
                </div>
              </div>
              <input
                type="text"
                value={cardHex}
                onChange={(e) => setCardHex(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && cardHex && identifyByRFID(cardHex)}
                placeholder="Aguardando leitura..."
                className="w-full px-3 py-2 text-[14px] border border-gray-200 rounded-xl outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-200"
                autoFocus
              />
            </div>
          )}

          {/* Facial */}
          {identifyMethod === 'facial' && (
            <div className="space-y-3">
              {/* Camera selector */}
              {cameras.length > 1 && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-[12px] font-medium text-gray-500 uppercase tracking-wide">Câmera</label>
                  <select
                    value={selectedCameraId}
                    onChange={(e) => setSelectedCameraId(e.target.value)}
                    className="w-full px-3 py-2 text-[13px] border border-gray-200 rounded-xl outline-none focus:border-gray-400 bg-white/70"
                  >
                    {cameras.map((c, i) => (
                      <option key={c.deviceId} value={c.deviceId}>
                        {c.label || `Câmera ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="relative rounded-xl overflow-hidden bg-gray-900 aspect-video">
                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                {!cameraActive && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Button onClick={startCamera} variant="secondary" size="sm">
                      <Camera size={14} />
                      Ativar câmera
                    </Button>
                  </div>
                )}
                {cameraActive && cameras.length === 1 && (
                  <button
                    onClick={startCamera}
                    className="absolute top-2 right-2 p-1.5 bg-black/40 rounded-lg text-white hover:bg-black/60 transition-colors"
                    title="Reiniciar câmera"
                  >
                    <RefreshCw size={13} />
                  </button>
                )}
              </div>

              <Button
                onClick={() => captureAndRecognize()}
                loading={identifying}
                disabled={!cameraActive}
                className="w-full justify-center"
              >
                <Camera size={15} />
                Capturar e Identificar
              </Button>
            </div>
          )}

          {identifying && (
            <div className="flex items-center justify-center gap-2 mt-3 text-[13px] text-gray-500">
              <Spinner size="sm" />
              Identificando...
            </div>
          )}

          {identifyError && (
            <p className="mt-3 text-[13px] text-red-500 animate-fadeIn">{identifyError}</p>
          )}
        </div>
      )}

      {/* ── Step: Sheets ── */}
      {step === 'sheets' && identifyResult && (
        <div className="space-y-4 animate-slideUp">
          <StudentCard result={identifyResult} />

          <div className="bg-white/70 backdrop-blur-xl border border-white/60 rounded-2xl shadow-glass p-6">
            <h2 className="text-[15px] font-semibold text-gray-900 mb-4">Quantidade de Folhas</h2>

            <Input
              label="Folhas a imprimir"
              type="number"
              min="1"
              inputMode="numeric"
              value={sheets}
              onChange={(e) => setSheets(onlyNumbers(e.target.value))}
              onKeyDown={(e) => e.key === 'Enter' && handleSheetsNext()}
              placeholder="0"
              autoFocus
            />

            {identifyResult.available_balance === 0 && (
              <p className="mt-2 text-[13px] text-amber-600">
                Saldo zerado — será necessário adicionar matrículas emprestadoras.
              </p>
            )}

            {/* Loan students */}
            {loanStudents.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-[12px] font-medium text-gray-500 uppercase tracking-wide">Emprestadores</p>
                {loanStudents.map((l, i) => (
                  <div key={l.identify_result.student.id} className="flex items-center gap-2">
                    <div className="flex-1">
                      <StudentCard result={l.identify_result} compact />
                    </div>
                    <button
                      onClick={() => setLoanStudents((prev) => prev.filter((_, j) => j !== i))}
                      className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {(() => {
              const needed = parseInt(sheets) || 0;
              if (needed <= 0) return null;
              const totalAvailable = (identifyResult?.available_balance ?? 0) + loanStudents.reduce((s, l) => s + l.identify_result.available_balance, 0);
              const shortage = Math.max(0, needed - totalAvailable);
              if (shortage > 0) return (
                <p className="mt-3 text-[13px] text-amber-600">
                  Faltam <strong>{shortage}</strong> folha{shortage !== 1 ? 's' : ''} — adicione matrículas emprestadoras.
                </p>
              );
              return (
                <p className="mt-3 text-[13px] text-emerald-600 font-medium">
                  ✓ Saldo suficiente para esta operação.
                </p>
              );
            })()}

            <button
              onClick={() => setAddingLoan(true)}
              className="mt-3 flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-gray-700 transition-colors"
            >
              <Plus size={14} />
              Adicionar matrícula emprestadora
            </button>

            {stackError && <p className="mt-3 text-[13px] text-red-500">{stackError}</p>}

            <div className="flex gap-2 mt-5">
              <Button variant="secondary" onClick={reset} size="sm">Cancelar</Button>
              <Button
                onClick={handleSheetsNext}
                loading={previewLoading}
                disabled={!sheets || parseInt(sheets) <= 0}
                className="flex-1 justify-center"
              >
                Avançar <ChevronRight size={15} />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Step: Stack confirmation ── */}
      {step === 'stack' && identifyResult && (
        <div className="space-y-4 animate-slideUp">
          <div className="bg-white/70 backdrop-blur-xl border border-white/60 rounded-2xl shadow-glass p-6">
            <h2 className="text-[15px] font-semibold text-gray-900 mb-4">Empilhamento de Matrículas</h2>
            <StackPreview debits={debits} totalSheets={parseInt(sheets)} />
            <div className="flex gap-2 mt-5">
              <Button variant="secondary" onClick={() => setStep('sheets')} size="sm">Voltar</Button>
              <Button onClick={() => setStep('confirm')} className="flex-1 justify-center">
                Confirmar empilhamento <ChevronRight size={15} />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Step: Final confirmation ── */}
      {step === 'confirm' && identifyResult && (
        <div className="space-y-4 animate-slideUp">
          <div className="bg-white/70 backdrop-blur-xl border border-white/60 rounded-2xl shadow-glass p-6">
            <h2 className="text-[15px] font-semibold text-gray-900 mb-4">Confirmar Impressão</h2>

            <div className="space-y-3 mb-5">
              <div className="flex justify-between text-[14px]">
                <span className="text-gray-500">Aluno</span>
                <span className="font-medium text-gray-900">{identifyResult.student.name}</span>
              </div>
              <div className="flex justify-between text-[14px]">
                <span className="text-gray-500">Total de folhas</span>
                <span className="font-bold text-gray-900">{sheets}</span>
              </div>
              {debits.length > 1 && (
                <div className="pt-2 border-t border-gray-100">
                  <p className="text-[12px] text-gray-500 mb-2">Distribuição:</p>
                  {debits.map((d) => (
                    <div key={d.student_id} className="flex justify-between text-[13px] py-1">
                      <span className="text-gray-600">{d.name} ({d.registration_number})</span>
                      <span className="font-medium">{d.sheets_to_debit} folhas</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setStep(debits.length > 1 ? 'stack' : 'sheets')} size="sm">
                Voltar
              </Button>
              <Button onClick={confirmPrint} loading={confirmLoading} className="flex-1 justify-center">
                Registrar impressão
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Step: Done ── */}
      {step === 'done' && (
        <div className="bg-white/70 backdrop-blur-xl border border-white/60 rounded-2xl shadow-glass p-8 text-center animate-scaleIn">
          <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-[17px] font-semibold text-gray-900">Impressão registrada</h2>
          <p className="text-[13px] text-gray-500 mt-1">Operação #{doneOperationId}</p>
          <Button onClick={reset} className="mt-6 mx-auto">
            Nova operação
          </Button>
        </div>
      )}

      {/* ── Add loan modal ── */}
      <Modal
        open={addingLoan}
        onClose={closeLoanModal}
        title="Adicionar Emprestador"
        size="sm"
      >
        {loanAddedMsg ? (
          <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200">
            <p className="text-[13px] text-emerald-700 font-medium">{loanAddedMsg}</p>
            <p className="text-[12px] text-gray-500 mt-1">Identifique o próximo emprestador.</p>
          </div>
        ) : (
          <p className="text-[13px] text-gray-500 mb-4">
            O emprestador deve estar fisicamente presente.
          </p>
        )}

        {/* Method tabs */}
        <div className="flex gap-1 p-1 bg-gray-100/80 rounded-xl mb-4">
          {([
            { key: 'manual', icon: <Keyboard size={14} />, label: 'Matrícula' },
            { key: 'rfid',   icon: <CreditCard size={14} />, label: 'Carteirinha' },
            { key: 'facial', icon: <Camera size={14} />, label: 'Facial' },
          ] as const).map((m) => (
            <button
              key={m.key}
              onClick={() => switchLoanMethod(m.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[13px] font-medium transition-all duration-150 ${
                loanIdentifyMethod === m.key
                  ? 'bg-white shadow-sm text-gray-900'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {m.icon}
              {m.label}
            </button>
          ))}
        </div>

        {/* Manual */}
        {loanIdentifyMethod === 'manual' && (
          <>
            <Input
              label="Matrícula do emprestador"
              value={loanRegistration}
              onChange={(e) => { setLoanAddedMsg(''); setLoanRegistration(onlyNumbers(e.target.value)); }}
              onKeyDown={(e) => e.key === 'Enter' && addLoanByManual()}
              placeholder="Somente números"
              inputMode="numeric"
              pattern="[0-9]*"
              autoFocus
            />
            <div className="flex gap-2 mt-4">
              <Button variant="secondary" onClick={closeLoanModal} size="sm">Cancelar</Button>
              <Button onClick={() => addLoanByManual()} loading={loanLoading} className="flex-1 justify-center" size="sm">
                Adicionar
              </Button>
            </div>
          </>
        )}

        {/* RFID */}
        {loanIdentifyMethod === 'rfid' && (
          <>
            <div className="flex items-center justify-center h-20 rounded-xl bg-gray-50 border-2 border-dashed border-gray-200 mb-3">
              <div className="text-center">
                <CreditCard size={24} className="text-gray-300 mx-auto mb-1" />
                <p className="text-[12px] text-gray-400">Aproxime o cartão ao leitor</p>
              </div>
            </div>
            <input
              type="text"
              value={loanCardHex}
              onChange={(e) => { setLoanAddedMsg(''); setLoanCardHex(e.target.value); }}
              onKeyDown={(e) => e.key === 'Enter' && loanCardHex && addLoanByRFID()}
              placeholder="Código do cartão (hex)"
              className="w-full px-3 py-2 text-[14px] border border-gray-200 rounded-xl outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-200"
              autoFocus
            />
            <div className="flex gap-2 mt-4">
              <Button variant="secondary" onClick={closeLoanModal} size="sm">Cancelar</Button>
              <Button onClick={() => addLoanByRFID()} loading={loanLoading} disabled={!loanCardHex} className="flex-1 justify-center" size="sm">
                Adicionar
              </Button>
            </div>
          </>
        )}

        {/* Facial */}
        {loanIdentifyMethod === 'facial' && (
          <>
            {cameras.length > 1 && (
              <div className="flex flex-col gap-1.5 mb-3">
                <label className="text-[12px] font-medium text-gray-500 uppercase tracking-wide">Câmera</label>
                <select
                  value={selectedCameraId}
                  onChange={(e) => setSelectedCameraId(e.target.value)}
                  className="w-full px-3 py-2 text-[13px] border border-gray-200 rounded-xl outline-none focus:border-gray-400 bg-white/70"
                >
                  {cameras.map((c, i) => (
                    <option key={c.deviceId} value={c.deviceId}>
                      {c.label || `Câmera ${i + 1}`}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="relative rounded-xl overflow-hidden bg-gray-900 aspect-video mb-1">
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              {!cameraActive && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Button onClick={startCamera} variant="secondary" size="sm">
                    <Camera size={14} />
                    Ativar câmera
                  </Button>
                </div>
              )}
            </div>
            {loanError && <p className="text-[12px] text-red-500 mb-2">{loanError}</p>}
            <div className="flex gap-2 mt-3">
              <Button variant="secondary" onClick={closeLoanModal} size="sm">Cancelar</Button>
              <Button onClick={() => addLoanByFacial()} loading={loanLoading} disabled={!cameraActive} className="flex-1 justify-center" size="sm">
                <Camera size={14} />
                Capturar e Adicionar
              </Button>
            </div>
          </>
        )}

        {loanLoading && loanIdentifyMethod !== 'manual' && loanIdentifyMethod !== 'rfid' && (
          <div className="flex items-center justify-center gap-2 mt-3 text-[13px] text-gray-500">
            <Spinner size="sm" />
            Identificando...
          </div>
        )}
      </Modal>

      {/* ── Error modal ── */}
      <Modal open={!!errorModal} onClose={() => setErrorModal('')} title="Atenção">
        <p className="text-[14px] text-gray-700">{errorModal}</p>
        <Button onClick={() => setErrorModal('')} className="mt-4 w-full justify-center" size="sm">
          Fechar
        </Button>
      </Modal>

      {/* ── Not in Lyceum confirmation modal ── */}
      <Modal
        open={!!notInLyceumModal}
        onClose={() => setNotInLyceumModal(null)}
        title="Matrícula não encontrada no Lyceum"
        size="sm"
      >
        <p className="text-[14px] text-gray-700">
          A matrícula <strong>{notInLyceumModal?.registration_number}</strong> não foi encontrada no Lyceum.
        </p>
        <p className="text-[13px] text-gray-500 mt-1">
          Deseja prosseguir mesmo assim? O registro será criado em modo de contingência.
        </p>
        <div className="flex gap-2 mt-5">
          <Button variant="secondary" onClick={() => setNotInLyceumModal(null)} size="sm">
            Cancelar
          </Button>
          <Button
            onClick={() => {
              const action = notInLyceumModal?.confirm;
              setNotInLyceumModal(null);
              action?.();
            }}
            className="flex-1 justify-center"
            size="sm"
          >
            Prosseguir assim mesmo
          </Button>
        </div>
      </Modal>
    </div>
  );
}
