import { useState, useRef, useCallback, useEffect } from 'react';
import { CreditCard, Keyboard, Camera, ChevronRight, Plus, Trash2, RefreshCw } from 'lucide-react';
import api from '../lib/api';
import { IdentifyResult, StackedDebit } from '../types';
import { StudentCard } from '../components/StudentCard';
import { Modal } from '../components/Modal';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Spinner } from '../components/Spinner';
import { extractApiError } from '../lib/errors';

// Interval between recognition requests in live mode.
// Industry standard for server-based face recognition: 250–500 ms.
// Lower = more responsive but higher server load; raise if the Vector AI service is slow.
const FACE_LIVE_INTERVAL_MS = 300;
const CAMERA_PREF_KEY = 'paperprint_preferred_camera';

type Step = 'identify' | 'sheets' | 'confirm' | 'done';
type IdentifyMethod = 'manual' | 'rfid' | 'facial';
type FaceBox = { top: number; right: number; bottom: number; left: number };

interface LoanStudent {
  identify_result: IdentifyResult;
  identify_method: IdentifyMethod;
}

interface FaceErrData {
  error?: string;
  box?: FaceBox;
  registration_number?: string;
}

function onlyNumbers(value: string): string {
  return value.replace(/\D/g, '');
}

function getNotInLyceumReg(err: unknown): string | null {
  const data = (err as { response?: { data?: { error?: string; registration_number?: string } } })?.response?.data;
  if (data?.error === 'STUDENT_NOT_IN_LYCEUM') return data.registration_number ?? '';
  return null;
}

function extractFaceErrData(err: unknown): FaceErrData | null {
  return (err as { response?: { data?: FaceErrData } })?.response?.data ?? null;
}

// Defined outside PrintFlowPage so React never unmounts it on re-render
interface CameraControlsProps {
  cameras: MediaDeviceInfo[];
  selectedCameraId: string;
  onSelect: (id: string) => void;
  onCycle: () => void;
  error?: string;
}

function CameraControls({ cameras, selectedCameraId, onSelect, onCycle, error }: CameraControlsProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        {cameras.length > 1 ? (
          <select
            value={selectedCameraId}
            onChange={(e) => onSelect(e.target.value)}
            className="flex-1 px-3 py-1.5 text-[12px] border border-gray-200 rounded-lg outline-none focus:border-gray-400 bg-white/70"
          >
            {cameras.map((c, i) => (
              <option key={c.deviceId} value={c.deviceId}>
                {c.label || `Câmera ${i + 1}`}
              </option>
            ))}
          </select>
        ) : cameras.length === 1 ? (
          <span className="flex-1 text-[12px] text-gray-500 truncate px-1">
            {cameras[0].label || 'Câmera 1'}
          </span>
        ) : null}
        <button
          type="button"
          onClick={onCycle}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors flex-shrink-0"
          title={cameras.length > 1 ? 'Trocar câmera' : 'Reiniciar câmera'}
        >
          <RefreshCw size={13} />
        </button>
      </div>
      {error && <p className="text-[12px] text-red-500">{error}</p>}
    </div>
  );
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
  const [selectedCameraId, setSelectedCameraId] = useState<string>(
    () => localStorage.getItem(CAMERA_PREF_KEY) || ''
  );
  const [cameraActive, setCameraActive] = useState(false);
  const [faceBox, setFaceBox] = useState<FaceBox | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const registrationInputRef = useRef<HTMLInputElement>(null);
  const liveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isRecognizingRef = useRef(false);
  // Always points to the freshest live handler (updated each render)
  const liveHandlerRef = useRef<(() => Promise<void>) | null>(null);
  // Callback ref: re-applies the stream every time a video element mounts (prevents black screen on re-render)
  const videoCallbackRef = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el && streamRef.current) el.srcObject = streamRef.current;
  }, []);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (liveTimerRef.current) clearInterval(liveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (step === 'identify' && identifyMethod === 'manual') {
      registrationInputRef.current?.focus();
    }
  }, [step, identifyMethod]);

  // ── Camera utilities ──────────────────────────────────────────────────────

  const stopLiveLoop = useCallback(() => {
    if (liveTimerRef.current) {
      clearInterval(liveTimerRef.current);
      liveTimerRef.current = null;
    }
    isRecognizingRef.current = false;
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraActive(false);
    setFaceBox(null);
    if (liveTimerRef.current) {
      clearInterval(liveTimerRef.current);
      liveTimerRef.current = null;
    }
    isRecognizingRef.current = false;
  }, []);

  const enumerateCameras = useCallback(async (): Promise<MediaDeviceInfo[]> => {
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ video: true });
      probe.getTracks().forEach((t) => t.stop());
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((d) => d.kind === 'videoinput');
      setCameras(inputs);
      return inputs;
    } catch {
      setIdentifyError('Câmera não disponível. Use outro método de identificação.');
      return [];
    }
  }, []);

  const startCamera = useCallback(async (overrideDeviceId?: string) => {
    const id = overrideDeviceId ?? selectedCameraId;
    stopCamera();
    try {
      const constraints: MediaStreamConstraints = {
        video: id ? { deviceId: { exact: id } } : { facingMode: 'user' },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraActive(true);
    } catch {
      setIdentifyError('Não foi possível acessar a câmera selecionada.');
    }
  }, [selectedCameraId, stopCamera]);

  const handleCameraChange = useCallback((deviceId: string) => {
    setSelectedCameraId(deviceId);
    localStorage.setItem(CAMERA_PREF_KEY, deviceId);
    if (cameraActive) startCamera(deviceId);
  }, [cameraActive, startCamera]);

  // Capture a single JPEG frame from the live video element
  const captureFrame = (): string | null => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return null;
    const offscreen = document.createElement('canvas');
    offscreen.width = video.videoWidth;
    offscreen.height = video.videoHeight;
    offscreen.getContext('2d')!.drawImage(video, 0, 0);
    return offscreen.toDataURL('image/jpeg', 0.8);
  };

  // ── Auto-start camera when switching to facial tab ────────────────────────

  useEffect(() => {
    if (identifyMethod !== 'facial' || step !== 'identify') return;
    let cancelled = false;
    (async () => {
      const inputs = await enumerateCameras();
      if (cancelled || inputs.length === 0) return;
      const savedId = localStorage.getItem(CAMERA_PREF_KEY);
      const deviceId = (savedId && inputs.some((d) => d.deviceId === savedId))
        ? savedId
        : inputs[0].deviceId;
      if (!cancelled) {
        setSelectedCameraId(deviceId);
        await startCamera(deviceId);
      }
    })();
    return () => { cancelled = true; };
  }, [identifyMethod]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!addingLoan || loanIdentifyMethod !== 'facial') return;
    let cancelled = false;
    (async () => {
      const inputs = await enumerateCameras();
      if (cancelled || inputs.length === 0) return;
      const savedId = localStorage.getItem(CAMERA_PREF_KEY);
      const deviceId = (savedId && inputs.some((d) => d.deviceId === savedId))
        ? savedId
        : inputs[0].deviceId;
      if (!cancelled) {
        setSelectedCameraId(deviceId);
        await startCamera(deviceId);
      }
    })();
    return () => { cancelled = true; };
  }, [addingLoan, loanIdentifyMethod]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Live recognition loop ─────────────────────────────────────────────────

  useEffect(() => {
    if (!cameraActive) return;
    if (liveTimerRef.current) clearInterval(liveTimerRef.current);
    isRecognizingRef.current = false;

    liveTimerRef.current = setInterval(async () => {
      if (isRecognizingRef.current || !liveHandlerRef.current) return;
      isRecognizingRef.current = true;
      try {
        await liveHandlerRef.current();
      } finally {
        isRecognizingRef.current = false;
      }
    }, FACE_LIVE_INTERVAL_MS);

    return () => {
      if (liveTimerRef.current) {
        clearInterval(liveTimerRef.current);
        liveTimerRef.current = null;
      }
    };
  }, [cameraActive]);

  // ── Draw face bounding box on overlay canvas ──────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas) return;

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;

    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);

    if (!faceBox || !video || !video.videoWidth) return;

    const { top, right, bottom, left } = faceBox;
    const vw = video.videoWidth;
    const vh = video.videoHeight;

    // Reproduce object-cover crop to align box coords with display
    const videoAspect = vw / vh;
    const displayAspect = w / h;
    let scale: number, ox = 0, oy = 0;
    if (videoAspect > displayAspect) {
      scale = h / vh;
      ox = (w - vw * scale) / 2;
    } else {
      scale = w / vw;
      oy = (h - vh * scale) / 2;
    }

    const bx = left * scale + ox;
    const by = top * scale + oy;
    const bw = (right - left) * scale;
    const bh = (bottom - top) * scale;
    const cs = Math.min(bw, bh) * 0.22;

    // Subtle filled rect
    ctx.fillStyle = 'rgba(34, 197, 94, 0.08)';
    ctx.fillRect(bx, by, bw, bh);

    // Border
    ctx.strokeStyle = 'rgba(34, 197, 94, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(bx, by, bw, bh);

    // Corner accent marks
    const drawCorner = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineTo(x3, y3);
      ctx.stroke();
    };
    ctx.strokeStyle = 'rgba(22, 163, 74, 0.95)';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    drawCorner(bx + cs, by, bx, by, bx, by + cs);
    drawCorner(bx + bw - cs, by, bx + bw, by, bx + bw, by + cs);
    drawCorner(bx, by + bh - cs, bx, by + bh, bx + cs, by + bh);
    drawCorner(bx + bw, by + bh - cs, bx + bw, by + bh, bx + bw - cs, by + bh);
  }, [faceBox]);

  // ── Live recognition handlers (re-created each render for fresh state) ────

  const mainLiveHandler = async () => {
    const image = captureFrame();
    if (!image) return;
    try {
      const res = await api.post<IdentifyResult>('/students/identify/facial', { image });
      setFaceBox(res.data.box ?? null);
      stopCamera();
      setIdentifyResult(res.data);
      setIdentifyMethodUsed('facial');
      setStep('sheets');
    } catch (err) {
      const data = extractFaceErrData(err);
      setFaceBox(data?.box ?? null);
      if (data?.error === 'STUDENT_NOT_IN_LYCEUM') {
        stopLiveLoop();
        const reg = data.registration_number ?? '';
        setNotInLyceumModal({
          registration_number: reg,
          confirm: async () => {
            const forceImage = captureFrame();
            if (!forceImage) return;
            setIdentifying(true);
            try {
              const r = await api.post<IdentifyResult>(
                '/students/identify/facial',
                { image: forceImage },
                { params: { force: 'true' } },
              );
              stopCamera();
              setIdentifyResult(r.data);
              setIdentifyMethodUsed('facial');
              setStep('sheets');
            } catch (e) {
              setIdentifyError(extractApiError(e));
            } finally {
              setIdentifying(false);
            }
          },
        });
      }
      // FACE_NOT_RECOGNIZED: loop continues automatically
    }
  };

  const loanLiveHandler = async () => {
    const image = captureFrame();
    if (!image) return;
    try {
      const res = await api.post<IdentifyResult>('/students/identify/facial', { image }, { params: { context: 'loan', primary_student_id: identifyResult?.student.id } });
      setFaceBox(res.data.box ?? null);
      stopLiveLoop();
      validateAndAddLoanStudent(res.data, 'facial');
    } catch (err) {
      const data = extractFaceErrData(err);
      setFaceBox(data?.box ?? null);
      if (data?.error === 'STUDENT_NOT_IN_LYCEUM') {
        stopLiveLoop();
        const reg = data.registration_number ?? '';
        setNotInLyceumModal({
          registration_number: reg,
          confirm: async () => {
            const forceImage = captureFrame();
            if (!forceImage) return;
            setLoanLoading(true);
            try {
              const r = await api.post<IdentifyResult>(
                '/students/identify/facial',
                { image: forceImage },
                { params: { force: 'true', context: 'loan', primary_student_id: identifyResult?.student.id } },
              );
              validateAndAddLoanStudent(r.data, 'facial');
            } catch (e) {
              setLoanError(extractApiError(e));
            } finally {
              setLoanLoading(false);
            }
          },
        });
      }
      // FACE_NOT_RECOGNIZED: loop continues automatically
    }
  };

  // Always keep the ref pointing to the freshest handler (avoids stale closures in the interval)
  liveHandlerRef.current = (addingLoan && loanIdentifyMethod === 'facial')
    ? loanLiveHandler
    : mainLiveHandler;

  // ── Other identification methods ──────────────────────────────────────────

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
      setStep('confirm');
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
        `${result.student.name} adicionado (+${result.available_balance} folha${result.available_balance !== 1 ? 's' : ''}). Ainda faltam ${remaining} folha${remaining !== 1 ? 's' : ''}.`
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
        { params: { ...(force ? { force: 'true' } : {}), context: 'loan', primary_student_id: identifyResult?.student.id } },
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
        { params: { ...(force ? { force: 'true' } : {}), context: 'loan', primary_student_id: identifyResult?.student.id } },
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
    if (method !== 'facial') stopCamera();
  };

  const handleCameraCycle = useCallback(() => {
    if (cameras.length > 1) {
      const idx = cameras.findIndex((c) => c.deviceId === selectedCameraId);
      handleCameraChange(cameras[(idx + 1) % cameras.length].deviceId);
    } else {
      startCamera();
    }
  }, [cameras, selectedCameraId, handleCameraChange, startCamera]);

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

          {/* Facial — live mode */}
          {identifyMethod === 'facial' && (
            <div className="space-y-3">
              <CameraControls
                cameras={cameras}
                selectedCameraId={selectedCameraId}
                onSelect={handleCameraChange}
                onCycle={handleCameraCycle}
                error={identifyError}
              />
              <div className="relative rounded-xl overflow-hidden bg-gray-900 aspect-[4/3]">
                <video ref={videoCallbackRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none' }} />
                {!cameraActive && (
                  <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80">
                    <Spinner size="sm" />
                    <span className="ml-2 text-white/80 text-[12px]">Iniciando câmera...</span>
                  </div>
                )}
                {cameraActive && (
                  <div className="absolute bottom-2 inset-x-0 flex justify-center pointer-events-none">
                    <div className="flex items-center gap-1.5 px-2.5 py-1 bg-black/35 backdrop-blur-sm rounded-full">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                      <span className="text-[11px] text-white/80 tracking-wide">
                        {faceBox ? 'Rosto detectado' : 'Escaneando...'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
              {identifying && (
                <div className="flex items-center justify-center gap-2 text-[13px] text-gray-500">
                  <Spinner size="sm" />
                  Verificando...
                </div>
              )}
            </div>
          )}

          {identifyMethod !== 'facial' && identifying && (
            <div className="flex items-center justify-center gap-2 mt-3 text-[13px] text-gray-500">
              <Spinner size="sm" />
              Identificando...
            </div>
          )}

          {identifyMethod !== 'facial' && identifyError && (
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
                  Saldo suficiente para esta operação.
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
              <Button variant="secondary" onClick={() => setStep('sheets')} size="sm">
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

        {/* Facial — live mode */}
        {loanIdentifyMethod === 'facial' && (
          <div className="space-y-3">
            <CameraControls
              cameras={cameras}
              selectedCameraId={selectedCameraId}
              onSelect={handleCameraChange}
              onCycle={handleCameraCycle}
              error={loanError}
            />
            <div className="relative rounded-xl overflow-hidden bg-gray-900 aspect-[4/3]">
              <video ref={videoCallbackRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none' }} />
              {!cameraActive && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80">
                  <Spinner size="sm" />
                  <span className="ml-2 text-white/80 text-[12px]">Iniciando câmera...</span>
                </div>
              )}
              {cameraActive && (
                <div className="absolute bottom-2 inset-x-0 flex justify-center pointer-events-none">
                  <div className="flex items-center gap-1.5 px-2.5 py-1 bg-black/35 backdrop-blur-sm rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                    <span className="text-[11px] text-white/80 tracking-wide">
                      {faceBox ? 'Rosto detectado' : 'Escaneando...'}
                    </span>
                  </div>
                </div>
              )}
            </div>
            {loanLoading && (
              <div className="flex items-center justify-center gap-2 text-[13px] text-gray-500">
                <Spinner size="sm" />
                Verificando...
              </div>
            )}
            <div className="flex gap-2 mt-1">
              <Button variant="secondary" onClick={closeLoanModal} size="sm">Cancelar</Button>
            </div>
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
