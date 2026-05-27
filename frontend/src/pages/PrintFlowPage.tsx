import { useState, useRef, useCallback, useEffect } from 'react';
import { CreditCard, Keyboard, Camera, ChevronRight, Plus, Trash2, RefreshCw, ArrowDown, ArrowUp, Clock, Printer, TrendingUp, TrendingDown, Briefcase, AlertTriangle, FileX } from 'lucide-react';
import api from '../lib/api';
import { IdentifyResult, StackedDebit, getUserIdentifier, getUserDetail } from '../types';
import { detectUserType } from '../lib/documentUtils';
import { useSSE } from '../hooks/useSSE';
import { StudentCard } from '../components/StudentCard';
import { Modal } from '../components/Modal';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Spinner } from '../components/Spinner';
import { extractApiError } from '../lib/errors';
import { SYNC_STATUS_LABELS } from '../lib/format';

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
  employee_code?: string;
}

interface WasteEventItem { id: number; type: 'error' | 'blank'; sheets: number; operator_login: string; created_at: string; user_name?: string; user_identifier?: string; user_type?: string; }
interface RecentEntry { id: number; type: 'own' | 'borrowed'; sheets: number; user_id: number; user_type: string; user_name?: string; user_identifier?: string; student_id?: number }
interface RecentOperation {
  id: number;
  user_name: string;
  user_identifier: string;
  user_id: number;
  user_type: string;
  user_detail?: string;
  total_sheets: number;
  identify_method: 'manual' | 'rfid' | 'facial';
  created_at: string;
  entries: RecentEntry[];
  // legacy
  student_name?: string;
  registration_number?: string;
  student_id?: number;
  student_course?: string;
  student_period?: string;
}

interface PrimaryEntry {
  id: number; user_id: number; user_type: string; sheets: number; type: 'own' | 'borrowed';
  user_name: string; user_identifier: string; detail?: string;
  // legacy
  student_id?: number; student_name?: string; registration_number?: string; course?: string; period?: string;
}
interface PrimaryOperation {
  id: number; total_sheets: number; status: string; created_at: string;
  operator_login: string; own_sheets: number; borrowed_sheets: number; entries: PrimaryEntry[];
}
interface LoanEntry {
  id: number; sheets: number; created_at: string; operation_id: number;
  operation_total: number; primary_user_id: number; primary_user_type: string;
  primary_user_name: string; primary_user_identifier: string; operator_login: string;
  // legacy
  primary_student_id?: number; primary_student_name?: string; primary_registration?: string;
}
interface FullHistory { as_primary: PrimaryOperation[]; as_lender: LoanEntry[] }

const METHOD_ICONS = { manual: Keyboard, rfid: CreditCard, facial: Camera } as const;

const METHOD_BADGE_CLASS: Record<string, string> = {
  manual: 'bg-gray-100 text-gray-500',
  rfid:   'bg-blue-50 text-blue-600',
  facial: 'bg-purple-50 text-purple-600',
};

function formatModalTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function shortName(full: string): string {
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]}` : parts[0];
}

function onlyNumbers(value: string): string {
  return value.replace(/\D/g, '');
}

function getNotInSystemDoc(err: unknown): string | null {
  const data = (err as { response?: { data?: { error?: string; registration_number?: string; employee_code?: string } } })?.response?.data;
  if (data?.error === 'STUDENT_NOT_IN_LYCEUM') return data.registration_number ?? '';
  if (data?.error === 'EMPLOYEE_NOT_IN_NASAJON') return data.employee_code ?? '';
  return null;
}

// kept for backward compat in existing call sites
function getNotInLyceumReg(err: unknown): string | null {
  return getNotInSystemDoc(err);
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

  const [recentOps, setRecentOps] = useState<RecentOperation[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [notInLyceumModal, setNotInLyceumModal] = useState<{ registration_number: string; confirm: () => void } | null>(null);

  // Student detail modal (triggered from recent ops list)
  const [selectedRecent, setSelectedRecent] = useState<{ id: number; registration_number: string; name: string; user_type?: string } | null>(null);
  const [recentDetailLoading, setRecentDetailLoading] = useState(false);
  const [recentStudentDetail, setRecentStudentDetail] = useState<IdentifyResult | null>(null);
  const [recentFullHistory, setRecentFullHistory] = useState<FullHistory | null>(null);
  const [recentModalOpsPage, setRecentModalOpsPage] = useState(1);

  // Done step auto-reset countdown
  const [doneCountdown, setDoneCountdown] = useState(10);

  const [addingLoan, setAddingLoan] = useState(false);
  const [loanIdentifyMethod, setLoanIdentifyMethod] = useState<IdentifyMethod>('manual');
  const [loanRegistration, setLoanRegistration] = useState('');
  const [loanCardHex, setLoanCardHex] = useState('');
  const [loanLoading, setLoanLoading] = useState(false);
  const [loanError, setLoanError] = useState('');
  const [loanAddedMsg, setLoanAddedMsg] = useState('');

  // Waste registration (print errors & blank pages)
  const [wasteModal, setWasteModal] = useState<'error' | 'blank' | null>(null);
  const [todayWaste, setTodayWaste] = useState<{ error_sheets: number; blank_sheets: number; events: WasteEventItem[] }>({ error_sheets: 0, blank_sheets: 0, events: [] });
  const [wasteSheets, setWasteSheets] = useState('');
  const [wasteLoading, setWasteLoading] = useState(false);
  const [wasteError, setWasteError] = useState('');

  // Blank page user identification sub-flow
  const [blankUserDoc, setBlankUserDoc] = useState('');
  const [blankUserLoading, setBlankUserLoading] = useState(false);
  const [blankUserError, setBlankUserError] = useState('');
  const [blankIdentified, setBlankIdentified] = useState<IdentifyResult | null>(null);
  const [blankLoanStudents, setBlankLoanStudents] = useState<IdentifyResult[]>([]);
  const [blankLoanDoc, setBlankLoanDoc] = useState('');
  const [blankLoanLoading, setBlankLoanLoading] = useState(false);
  const [blankLoanError, setBlankLoanError] = useState('');
  const [blankDebits, setBlankDebits] = useState<StackedDebit[] | null>(null);
  const [blankPreviewLoading, setBlankPreviewLoading] = useState(false);
  const [blankStackError, setBlankStackError] = useState('');

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
  const advanceButtonRef = useRef<HTMLButtonElement>(null);
  const loanRegistrationInputRef = useRef<HTMLInputElement>(null);
  const [shouldFocusAdvance, setShouldFocusAdvance] = useState(false);
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

  const loadRecentOps = useCallback(async () => {
    setRecentLoading(true);
    try {
      const [opsRes, wasteRes] = await Promise.all([
        api.get<{ operations: RecentOperation[] }>('/print/operations/recent?limit=10'),
        api.get<{ error_sheets: number; blank_sheets: number; events: WasteEventItem[] }>('/waste/today'),
      ]);
      setRecentOps(opsRes.data.operations);
      setTodayWaste(wasteRes.data);
    } catch {
      // silently fail — list is non-critical
    } finally {
      setRecentLoading(false);
    }
  }, []);

  useEffect(() => {
    if (step === 'identify') loadRecentOps();
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh recent ops in real time when another machine registers a print
  useSSE('print_registered', () => {
    if (step === 'identify') loadRecentOps();
  });

  // "P" shortcut — open loan modal from sheets step
  useEffect(() => {
    if (step !== 'sheets') return;
    const handler = (e: KeyboardEvent) => {
      if ((e.key === 'p' || e.key === 'P') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setAddingLoan(true);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [step]);

  // Focus "Avançar" button after loan modal closes with sufficient balance
  useEffect(() => {
    if (shouldFocusAdvance && !addingLoan && step === 'sheets') {
      advanceButtonRef.current?.focus();
      setShouldFocusAdvance(false);
    }
  }, [shouldFocusAdvance, addingLoan, step]);

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
    const primaryId = identifyResult?.user.id;
    const primaryType = identifyResult?.user_type;
    try {
      const res = await api.post<IdentifyResult>('/students/identify/facial', { image }, {
        params: { context: 'loan', primary_student_id: primaryType === 'student' ? primaryId : undefined },
      });
      setFaceBox(res.data.box ?? null);
      stopLiveLoop();
      validateAndAddLoanStudent(res.data, 'facial');
    } catch (err) {
      const data = extractFaceErrData(err);
      setFaceBox(data?.box ?? null);
      if (data?.error === 'STUDENT_NOT_IN_LYCEUM' || data?.error === 'EMPLOYEE_NOT_IN_NASAJON') {
        stopLiveLoop();
        const doc = data.registration_number ?? data.employee_code ?? '';
        setNotInLyceumModal({
          registration_number: doc,
          confirm: async () => {
            const forceImage = captureFrame();
            if (!forceImage) return;
            setLoanLoading(true);
            try {
              const r = await api.post<IdentifyResult>(
                '/students/identify/facial',
                { image: forceImage },
                { params: { force: 'true', context: 'loan', primary_student_id: primaryType === 'student' ? primaryId : undefined } },
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
    }
  };

  // Always keep the ref pointing to the freshest handler (avoids stale closures in the interval)
  liveHandlerRef.current = (addingLoan && loanIdentifyMethod === 'facial')
    ? loanLiveHandler
    : mainLiveHandler;

  // ── Other identification methods ──────────────────────────────────────────

  const identifyByManual = async (force = false) => {
    const doc = registration.trim();
    if (!doc) return;
    setIdentifying(true);
    setIdentifyError('');
    try {
      const userType = detectUserType(doc);
      let res;
      if (userType === 'student') {
        res = await api.post<IdentifyResult>(
          '/students/identify/manual',
          { registration_number: doc },
          force ? { params: { force: 'true' } } : undefined,
        );
      } else {
        res = await api.post<IdentifyResult>(
          '/employees/identify/manual',
          { employee_code: doc },
          force ? { params: { force: 'true' } } : undefined,
        );
      }
      setIdentifyResult(res.data);
      setIdentifyMethodUsed('manual');
      setStep('sheets');
    } catch (err) {
      const notInSystem = getNotInSystemDoc(err);
      if (notInSystem !== null) {
        setNotInLyceumModal({ registration_number: notInSystem, confirm: () => identifyByManual(true) });
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
      const extraUsers = loanStudents.map((l) => ({
        user_id: l.identify_result.user.id,
        user_type: l.identify_result.user_type,
      }));
      const res = await api.post<{ debits: StackedDebit[] }>('/print/preview-stack', {
        primary_user_id: identifyResult.user.id,
        primary_user_type: identifyResult.user_type,
        total_sheets: n,
        extra_users: extraUsers,
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
    const isSamePrimary = result.user.id === identifyResult?.user.id && result.user_type === identifyResult?.user_type;
    if (isSamePrimary) {
      setErrorModal('O emprestador não pode ser o próprio solicitante da impressão.');
      return false;
    }
    const isDuplicate = loanStudents.some(
      (l) => l.identify_result.user.id === result.user.id && l.identify_result.user_type === result.user_type
    );
    if (isDuplicate) {
      setErrorModal('Este usuário já foi adicionado como emprestador.');
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
        `${result.user.name} adicionado (+${result.available_balance} folha${result.available_balance !== 1 ? 's' : ''}). Ainda faltam ${remaining} folha${remaining !== 1 ? 's' : ''}.`
      );
      return true;
    }

    setShouldFocusAdvance(true);
    closeLoanModal();
    return true;
  };

  const addLoanByManual = async (force = false) => {
    const doc = loanRegistration.trim();
    if (!doc) return;
    setLoanLoading(true);
    try {
      const userType = detectUserType(doc);
      const primaryId = identifyResult?.user.id;
      const primaryType = identifyResult?.user_type;
      let res;
      if (userType === 'student') {
        res = await api.post<IdentifyResult>(
          '/students/identify/manual',
          { registration_number: doc },
          { params: { ...(force ? { force: 'true' } : {}), context: 'loan', primary_student_id: primaryType === 'student' ? primaryId : undefined } },
        );
      } else {
        res = await api.post<IdentifyResult>(
          '/employees/identify/manual',
          { employee_code: doc },
          { params: { ...(force ? { force: 'true' } : {}), context: 'loan', primary_user_id: primaryId, primary_user_type: primaryType } },
        );
      }
      validateAndAddLoanStudent(res.data, 'manual');
    } catch (err) {
      const doc2 = getNotInSystemDoc(err);
      if (doc2 !== null) {
        setNotInLyceumModal({ registration_number: doc2, confirm: () => addLoanByManual(true) });
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
      const primaryId = identifyResult?.user.id;
      const primaryType = identifyResult?.user_type;
      const res = await api.post<IdentifyResult>(
        '/students/identify/rfid',
        { card_hex: loanCardHex.trim() },
        { params: { ...(force ? { force: 'true' } : {}), context: 'loan', primary_student_id: primaryType === 'student' ? primaryId : undefined } },
      );
      validateAndAddLoanStudent(res.data, 'rfid');
    } catch (err) {
      const doc = getNotInSystemDoc(err);
      if (doc !== null) {
        setNotInLyceumModal({ registration_number: doc, confirm: () => addLoanByRFID(true) });
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
        const isPrimary = d.user_id === identifyResult.user.id && d.user_type === identifyResult.user_type;
        if (isPrimary) return { ...d, identify_method: identifyMethodUsed };
        const loan = loanStudents.find(
          (l) => l.identify_result.user.id === d.user_id && l.identify_result.user_type === d.user_type
        );
        return { ...d, identify_method: loan?.identify_method ?? 'manual' };
      });
      const res = await api.post<{ operation_id: number }>('/print/register', {
        primary_user_id: identifyResult.user.id,
        primary_user_type: identifyResult.user_type,
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

  const reset = useCallback(() => {
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
  }, [stopCamera]);

  const switchMethod = (method: IdentifyMethod) => {
    setIdentifyMethod(method);
    setIdentifyError('');
    if (method !== 'facial') stopCamera();
  };

  const resetBlankModal = () => {
    setWasteModal(null);
    setBlankIdentified(null);
    setBlankUserDoc('');
    setBlankUserError('');
    setBlankLoanStudents([]);
    setBlankLoanDoc('');
    setBlankLoanError('');
    setBlankDebits(null);
    setBlankPreviewLoading(false);
    setBlankStackError('');
    setWasteSheets('');
    setWasteError('');
  };

  const addBlankLoan = async () => {
    const doc = blankLoanDoc.trim();
    if (!doc || !blankIdentified) return;
    setBlankLoanLoading(true); setBlankLoanError('');
    try {
      const userType = detectUserType(doc);
      const endpoint = userType === 'student' ? '/students/identify/manual' : '/employees/identify/manual';
      const body = userType === 'student' ? { registration_number: doc } : { employee_code: doc };
      const res = await api.post<IdentifyResult>(endpoint, body);
      if (res.data.user.id === blankIdentified.user.id && res.data.user_type === blankIdentified.user_type) {
        setBlankLoanError('Este é o usuário principal.');
        return;
      }
      if (blankLoanStudents.some(l => l.user.id === res.data.user.id && l.user_type === res.data.user_type)) {
        setBlankLoanError('Este usuário já foi adicionado.');
        return;
      }
      setBlankLoanStudents(prev => [...prev, res.data]);
      setBlankLoanDoc('');
    } catch (err) {
      const code = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      if (code === 'STUDENT_NOT_FOUND' || code === 'EMPLOYEE_NOT_FOUND') setBlankLoanError('Usuário não encontrado.');
      else if (code === 'STUDENT_NOT_ENROLLED') setBlankLoanError('Aluno sem matrícula ativa.');
      else setBlankLoanError('Não foi possível identificar. Tente novamente.');
    } finally { setBlankLoanLoading(false); }
  };

  const previewBlankDebits = async () => {
    const n = parseInt(wasteSheets);
    if (!n || n < 1 || !blankIdentified) return;
    setBlankPreviewLoading(true); setBlankStackError('');
    try {
      const res = await api.post<{ debits: StackedDebit[] }>('/print/preview-stack', {
        primary_user_id: blankIdentified.user.id,
        primary_user_type: blankIdentified.user_type,
        total_sheets: n,
        extra_users: blankLoanStudents.map(l => ({ user_id: l.user.id, user_type: l.user_type })),
      });
      setBlankDebits(res.data.debits);
    } catch (err) {
      const code = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      if (code === 'INSUFFICIENT_TOTAL_BALANCE') {
        setBlankStackError('Saldo insuficiente mesmo com os emprestadores. Adicione mais matrículas.');
      } else {
        setBlankStackError('Erro ao verificar saldo. Tente novamente.');
      }
    } finally { setBlankPreviewLoading(false); }
  };

  const confirmBlankWaste = async () => {
    if (!blankIdentified || !blankDebits) return;
    const n = parseInt(wasteSheets);
    setWasteLoading(true); setWasteError('');
    try {
      await api.post('/waste', {
        type: 'blank',
        sheets: n,
        user_id: blankIdentified.user.id,
        user_type: blankIdentified.user_type,
        stacked_debits: blankDebits,
      });
      resetBlankModal(); loadRecentOps();
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? '';
      if (msg.startsWith('INSUFFICIENT_BALANCE')) {
        setWasteError('Saldo insuficiente. Volte e revise os emprestadores.');
        setBlankDebits(null);
      } else {
        setWasteError('Não foi possível registrar. Tente novamente.');
      }
    } finally { setWasteLoading(false); }
  };

  const openRecentDetail = async (op: RecentOperation) => {
    const userId = op.user_id ?? op.student_id ?? 0;
    const userType = op.user_type || 'student';
    const identifier = op.user_identifier ?? op.registration_number ?? '';
    const name = op.user_name ?? op.student_name ?? '';
    setSelectedRecent({ id: userId, registration_number: identifier, name, user_type: userType });
    setRecentDetailLoading(true);
    setRecentStudentDetail(null);
    setRecentFullHistory(null);
    setRecentModalOpsPage(1);
    const todayDate = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
    try {
      let detailRes;
      if (userType === 'employee') {
        detailRes = await api.post<IdentifyResult>('/employees/identify/manual', { employee_code: identifier });
      } else {
        detailRes = await api.post<IdentifyResult>('/students/identify/manual', { registration_number: identifier });
      }
      const histEndpoint = userType === 'employee' ? `/employees/${userId}/full-history` : `/students/${userId}/full-history`;
      const histRes = await api.get<FullHistory>(histEndpoint, { params: { date: todayDate } });
      setRecentStudentDetail(detailRes.data);
      setRecentFullHistory(histRes.data);
    } finally {
      setRecentDetailLoading(false);
    }
  };

  // Auto-reset 10 seconds after a successful print
  useEffect(() => {
    if (step !== 'done') return;
    setDoneCountdown(10);
    const interval = setInterval(() => {
      setDoneCountdown((prev) => {
        if (prev <= 1) { clearInterval(interval); reset(); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [step, reset]);

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
          <h2 className="text-[16px] font-semibold text-gray-900 mb-5">Identificar Usuário</h2>

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
              {(() => {
                const detectedType = registration.length > 0 ? detectUserType(registration) : null;
                return (
                  <div className="relative">
                    <Input
                      ref={registrationInputRef}
                      label={detectedType === 'employee' ? 'Código / CPF (Funcionário)' : 'Matrícula'}
                      value={registration}
                      onChange={(e) => setRegistration(onlyNumbers(e.target.value))}
                      onKeyDown={(e) => e.key === 'Enter' && identifyByManual()}
                      placeholder="Somente números"
                      inputMode="numeric"
                      pattern="[0-9]*"
                    />
                    {detectedType === 'employee' && (
                      <span className="absolute right-3 top-8 flex items-center gap-1 text-[11px] text-blue-500 font-medium pointer-events-none">
                        <Briefcase size={11} /> Funcionário
                      </span>
                    )}
                  </div>
                );
              })()}
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

      {/* ── Special print actions (identify step only) ── */}
      {step === 'identify' && (
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => { setWasteSheets(''); setWasteError(''); setWasteModal('error'); }}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-white/70 backdrop-blur-xl border border-white/60 shadow-glass-sm text-[13px] font-medium text-red-600 hover:bg-red-50/70 transition-colors"
          >
            <AlertTriangle size={14} />
            Erro de impressão
          </button>
          <button
            onClick={() => { resetBlankModal(); setWasteModal('blank'); }}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-white/70 backdrop-blur-xl border border-white/60 shadow-glass-sm text-[13px] font-medium text-gray-600 hover:bg-gray-50/70 transition-colors"
          >
            <FileX size={14} />
            Folhas em branco
          </button>
        </div>
      )}

      {/* ── Recent operations list (identify step only) ── */}
      {step === 'identify' && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest px-1">Últimas operações</p>

          {recentLoading ? (
            <div className="flex justify-center py-6"><Spinner size="sm" /></div>
          ) : recentOps.length === 0 && todayWaste.events.length === 0 ? (
            <p className="text-center text-[13px] text-gray-400 py-4">Nenhuma operação registrada ainda.</p>
          ) : (
            <div className="bg-white/70 backdrop-blur-xl border border-white/60 rounded-2xl shadow-glass divide-y divide-gray-100/60 overflow-hidden">
              {recentOps.map((op) => {
                const hasBorrowed = op.entries.some((e) => e.type === 'borrowed');
                const MethodIcon = METHOD_ICONS[op.identify_method] ?? Keyboard;
                const badgeClass = METHOD_BADGE_CLASS[op.identify_method] ?? 'bg-gray-100 text-gray-500';
                const time = new Date(op.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                return (
                  <div key={op.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50/40 transition-colors">
                    {/* Identify method badge with color */}
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${badgeClass}`}>
                      <MethodIcon size={13} />
                    </div>

                    {/* Student info — name is clickable */}
                    <div className="flex-1 min-w-0">
                      <button
                        onClick={() => openRecentDetail(op)}
                        className="text-left group"
                      >
                        <p className="text-[13px] font-semibold text-gray-900 truncate leading-tight group-hover:text-blue-600 transition-colors">
                          {shortName(op.user_name ?? op.student_name ?? '')}
                        </p>
                      </button>
                      <p className="text-[11px] text-gray-400 truncate leading-snug mt-0.5">
                        {op.user_identifier ?? op.registration_number ?? ''}
                        {op.user_detail ? ` · ${op.user_detail}` : (op.student_course ? ` · ${op.student_course}` : '')}
                        {!op.user_detail && op.student_period ? ` · ${op.student_period}` : ''}
                        {op.user_type === 'employee' && (
                          <span className="ml-1 text-blue-400">· Func.</span>
                        )}
                      </p>
                    </div>

                    {/* Sheets + direction + time */}
                    <div className="flex flex-col items-end gap-0.5 shrink-0">
                      <div className="flex items-center gap-1">
                        <ArrowDown size={12} className="text-emerald-500" />
                        <span className="text-[13px] font-bold text-gray-900">{op.total_sheets}</span>
                        <span className="text-[11px] text-gray-400">fls</span>
                        {hasBorrowed && <ArrowUp size={12} className="text-amber-400" />}
                      </div>
                      <span className="text-[10px] text-gray-300">{time}</span>
                    </div>
                  </div>
                );
              })}

              {/* Waste events */}
              {todayWaste.events.length > 0 && (
                <>
                  <div className={`px-4 py-2 bg-gray-50/40 ${recentOps.length > 0 ? 'border-t border-gray-100/60' : ''}`}>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Erros e folhas em branco</p>
                  </div>
                  {todayWaste.events.map((e) => (
                    <div key={`waste-${e.id}`} className="flex items-center gap-3 px-4 py-2.5">
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${e.type === 'error' ? 'bg-red-50 text-red-400' : 'bg-gray-100 text-gray-400'}`}>
                        {e.type === 'error' ? <AlertTriangle size={13} /> : <FileX size={13} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-gray-700">
                          {e.type === 'error' ? 'Erro de impressão' : (e.user_name ? shortName(e.user_name) : 'Folhas em branco')}
                        </p>
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          {e.type === 'blank' && e.user_identifier ? `${e.user_identifier} · ` : ''}
                          {e.operator_login}
                          {e.type === 'blank' && e.user_type === 'employee' ? ' · Func.' : ''}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-0.5 shrink-0">
                        <span className="text-[13px] font-bold text-gray-500">{e.sheets}</span>
                        <span className="text-[10px] text-gray-300">{new Date(e.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
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
                  <div key={`${l.identify_result.user_type}-${l.identify_result.user.id}`} className="flex items-center gap-2">
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
              <span className="font-mono text-[11px] text-gray-300 leading-none">(p)</span>
              Adicionar matrícula emprestadora
            </button>

            {stackError && <p className="mt-3 text-[13px] text-red-500">{stackError}</p>}

            <div className="flex gap-2 mt-5">
              <Button variant="secondary" onClick={reset} size="sm">Cancelar</Button>
              <Button
                ref={advanceButtonRef}
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
                <span className="text-gray-500">{identifyResult.user_type === 'employee' ? 'Funcionário' : 'Aluno'}</span>
                <span className="font-medium text-gray-900">{identifyResult.user.name}</span>
              </div>
              <div className="flex justify-between text-[14px]">
                <span className="text-gray-500">Total de folhas</span>
                <span className="font-bold text-gray-900">{sheets}</span>
              </div>
              {debits.length > 1 && (
                <div className="pt-2 border-t border-gray-100">
                  <p className="text-[12px] text-gray-500 mb-2">Distribuição:</p>
                  {debits.map((d) => (
                    <div key={`${d.user_type}:${d.user_id}`} className="flex justify-between text-[13px] py-1">
                      <span className="text-gray-600">{d.name} ({d.identifier}){d.user_type === 'employee' ? ' · Func.' : ''}</span>
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
              <Button onClick={confirmPrint} loading={confirmLoading} className="flex-1 justify-center" autoFocus>
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
          <Button onClick={reset} className="mt-6 mx-auto" autoFocus>
            Nova operação
          </Button>
          <p className="text-[11px] text-gray-300 mt-3">
            Voltando automaticamente em {doneCountdown}s
          </p>
          {/* Countdown progress bar */}
          <div className="mt-2 mx-auto w-32 h-0.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gray-300 rounded-full transition-none"
              style={{ width: `${(doneCountdown / 10) * 100}%` }}
            />
          </div>
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
              ref={loanRegistrationInputRef}
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
      <Modal open={!!errorModal} onClose={() => {
        setErrorModal('');
        if (addingLoan && loanIdentifyMethod === 'manual') {
          setLoanRegistration('');
          setTimeout(() => loanRegistrationInputRef.current?.focus(), 50);
        }
      }} title="Atenção">
        <p className="text-[14px] text-gray-700">{errorModal}</p>
        <Button onClick={() => {
          setErrorModal('');
          if (addingLoan && loanIdentifyMethod === 'manual') {
            setLoanRegistration('');
            setTimeout(() => loanRegistrationInputRef.current?.focus(), 50);
          }
        }} className="mt-4 w-full justify-center" size="sm" autoFocus>
          Fechar
        </Button>
      </Modal>

      {/* ── Error waste modal ── */}
      <Modal
        open={wasteModal === 'error'}
        onClose={() => setWasteModal(null)}
        title="Registrar Erro de Impressão"
        size="sm"
      >
        <p className="text-[13px] text-gray-500 mb-4">
          Registre folhas perdidas por falha, atolamento ou descarte durante a impressão. Essas folhas não são debitadas de nenhuma cota.
        </p>
        <Input
          label="Número de folhas"
          type="number"
          min="1"
          step="1"
          value={wasteSheets}
          onChange={(e) => setWasteSheets(e.target.value.replace(/[^0-9]/g, ''))}
          onKeyDown={async (e) => {
            if (e.key === 'Enter') {
              const n = parseInt(wasteSheets);
              if (!n || n < 1) { setWasteError('Informe um número válido.'); return; }
              setWasteLoading(true); setWasteError('');
              try {
                await api.post('/waste', { type: 'error', sheets: n });
                setWasteModal(null); loadRecentOps();
              } catch { setWasteError('Não foi possível registrar. Tente novamente.'); }
              finally { setWasteLoading(false); }
            }
          }}
          autoFocus
        />
        {wasteError && <p className="text-[13px] text-red-500 mt-2">{wasteError}</p>}
        <div className="flex gap-2 mt-4">
          <Button variant="secondary" size="sm" onClick={() => setWasteModal(null)}>Cancelar</Button>
          <Button
            size="sm"
            className="flex-1 justify-center"
            loading={wasteLoading}
            onClick={async () => {
              const n = parseInt(wasteSheets);
              if (!n || n < 1) { setWasteError('Informe um número válido.'); return; }
              setWasteLoading(true); setWasteError('');
              try {
                await api.post('/waste', { type: 'error', sheets: n });
                setWasteModal(null); loadRecentOps();
              } catch { setWasteError('Não foi possível registrar. Tente novamente.'); }
              finally { setWasteLoading(false); }
            }}
          >
            Registrar
          </Button>
        </div>
      </Modal>

      {/* ── Blank page modal — 3 steps: identify → sheets+loans → confirm ── */}
      <Modal
        open={wasteModal === 'blank'}
        onClose={resetBlankModal}
        title="Registrar Folhas em Branco"
        size="sm"
      >
        {/* Step 1: Identify user */}
        {!blankIdentified && (
          <>
            <p className="text-[13px] text-gray-500 mb-4">
              Folhas em branco debitam a cota do solicitante. Informe a matrícula ou código do funcionário.
            </p>
            <Input
              label="Matrícula / Código"
              type="text"
              value={blankUserDoc}
              onChange={(e) => setBlankUserDoc(onlyNumbers(e.target.value))}
              onKeyDown={async (e) => {
                if (e.key !== 'Enter') return;
                const doc = blankUserDoc.trim();
                if (!doc) { setBlankUserError('Informe a matrícula ou código.'); return; }
                setBlankUserLoading(true); setBlankUserError('');
                try {
                  const userType = detectUserType(doc);
                  const res = await api.post<IdentifyResult>(
                    userType === 'student' ? '/students/identify/manual' : '/employees/identify/manual',
                    userType === 'student' ? { registration_number: doc } : { employee_code: doc },
                  );
                  setBlankIdentified(res.data);
                } catch (err) {
                  const code = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
                  if (code === 'STUDENT_NOT_FOUND' || code === 'EMPLOYEE_NOT_FOUND') setBlankUserError('Usuário não encontrado.');
                  else if (code === 'STUDENT_NOT_ENROLLED') setBlankUserError('Aluno sem matrícula ativa.');
                  else setBlankUserError('Não foi possível identificar. Tente novamente.');
                } finally { setBlankUserLoading(false); }
              }}
              autoFocus
            />
            {blankUserError && <p className="text-[13px] text-red-500 mt-2">{blankUserError}</p>}
            <div className="flex gap-2 mt-4">
              <Button variant="secondary" size="sm" onClick={resetBlankModal}>Cancelar</Button>
              <Button
                size="sm"
                className="flex-1 justify-center"
                loading={blankUserLoading}
                onClick={async () => {
                  const doc = blankUserDoc.trim();
                  if (!doc) { setBlankUserError('Informe a matrícula ou código.'); return; }
                  setBlankUserLoading(true); setBlankUserError('');
                  try {
                    const userType = detectUserType(doc);
                    const res = await api.post<IdentifyResult>(
                      userType === 'student' ? '/students/identify/manual' : '/employees/identify/manual',
                      userType === 'student' ? { registration_number: doc } : { employee_code: doc },
                    );
                    setBlankIdentified(res.data);
                  } catch (err) {
                    const code = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
                    if (code === 'STUDENT_NOT_FOUND' || code === 'EMPLOYEE_NOT_FOUND') setBlankUserError('Usuário não encontrado.');
                    else if (code === 'STUDENT_NOT_ENROLLED') setBlankUserError('Aluno sem matrícula ativa.');
                    else setBlankUserError('Não foi possível identificar. Tente novamente.');
                  } finally { setBlankUserLoading(false); }
                }}
              >
                Identificar
              </Button>
            </div>
          </>
        )}

        {/* Step 2: Enter sheets + optional loan students */}
        {blankIdentified && !blankDebits && (() => {
          const needed = parseInt(wasteSheets) || 0;
          const totalAvail = blankIdentified.available_balance + blankLoanStudents.reduce((s, l) => s + l.available_balance, 0);
          const shortage = needed > 0 ? Math.max(0, needed - totalAvail) : 0;
          return (
            <>
              {/* Primary user card */}
              <div className="flex items-center gap-3 p-3 mb-3 rounded-2xl bg-gray-50/80 border border-gray-100">
                {blankIdentified.photo ? (
                  <img src={`data:image/jpeg;base64,${blankIdentified.photo}`} alt={blankIdentified.user.name}
                    className="w-10 h-10 rounded-xl object-cover border border-white/60 shadow-sm shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded-xl bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-400 text-base font-semibold shrink-0">
                    {blankIdentified.user.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-gray-900 truncate">{blankIdentified.user.name}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">{getUserIdentifier(blankIdentified.user, blankIdentified.user_type)}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[11px] text-gray-400">Saldo</p>
                  <p className={`text-[13px] font-bold ${blankIdentified.available_balance === 0 ? 'text-red-500' : 'text-gray-900'}`}>
                    {blankIdentified.available_balance} fls
                  </p>
                </div>
                <button onClick={() => { setBlankIdentified(null); setBlankLoanStudents([]); setBlankLoanDoc(''); setBlankLoanError(''); setBlankStackError(''); }}
                  className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors shrink-0" title="Trocar usuário">
                  <RefreshCw size={13} />
                </button>
              </div>

              <Input
                label="Folhas em branco"
                type="number" min="1" step="1"
                value={wasteSheets}
                onChange={(e) => { setWasteSheets(e.target.value.replace(/[^0-9]/g, '')); setBlankStackError(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter' && parseInt(wasteSheets) > 0) previewBlankDebits(); }}
                autoFocus
              />

              {/* Balance feedback */}
              {needed > 0 && shortage === 0 && (
                <p className="mt-2 text-[13px] text-emerald-600 font-medium">Saldo suficiente para esta operação.</p>
              )}
              {needed > 0 && shortage > 0 && (
                <p className="mt-2 text-[13px] text-amber-600">
                  Faltam <strong>{shortage}</strong> folha{shortage !== 1 ? 's' : ''} — adicione matrículas emprestadoras.
                </p>
              )}

              {/* Loan students list */}
              {blankLoanStudents.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Emprestadores</p>
                  {blankLoanStudents.map((l, i) => (
                    <div key={`${l.user_type}-${l.user.id}`} className="flex items-center gap-2 p-2 rounded-xl bg-gray-50 border border-gray-100">
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium text-gray-800 truncate">{shortName(l.user.name)}</p>
                        <p className="text-[11px] text-gray-400">{getUserIdentifier(l.user, l.user_type)} · {l.available_balance} fls</p>
                      </div>
                      <button onClick={() => setBlankLoanStudents(prev => prev.filter((_, j) => j !== i))}
                        className="p-1 text-gray-400 hover:text-red-500 transition-colors shrink-0">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add loan student input */}
              <div className="mt-3 flex gap-2 items-end">
                <div className="flex-1">
                  <Input
                    label="Matrícula emprestadora"
                    type="text"
                    value={blankLoanDoc}
                    onChange={(e) => { setBlankLoanDoc(onlyNumbers(e.target.value)); setBlankLoanError(''); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') addBlankLoan(); }}
                  />
                </div>
                <Button size="sm" variant="secondary" loading={blankLoanLoading} onClick={addBlankLoan}
                  className="mb-0 shrink-0" disabled={!blankLoanDoc.trim()}>
                  <Plus size={14} />
                </Button>
              </div>
              {blankLoanError && <p className="text-[12px] text-red-500 mt-1">{blankLoanError}</p>}

              {blankStackError && <p className="mt-2 text-[13px] text-red-500">{blankStackError}</p>}

              <div className="flex gap-2 mt-4">
                <Button variant="secondary" size="sm" onClick={resetBlankModal}>Cancelar</Button>
                <Button
                  size="sm" className="flex-1 justify-center"
                  loading={blankPreviewLoading}
                  disabled={!wasteSheets || parseInt(wasteSheets) < 1}
                  onClick={previewBlankDebits}
                >
                  Verificar <ChevronRight size={14} />
                </Button>
              </div>
            </>
          );
        })()}

        {/* Step 3: Debit breakdown + confirm */}
        {blankIdentified && blankDebits && (
          <>
            <div className="space-y-2 mb-4 p-3 rounded-2xl bg-gray-50/80 border border-gray-100">
              <div className="flex justify-between text-[13px]">
                <span className="text-gray-500">Total de folhas</span>
                <span className="font-bold text-gray-900">{wasteSheets}</span>
              </div>
              {blankDebits.length > 1 && (
                <div className="pt-2 border-t border-gray-100 space-y-1">
                  <p className="text-[11px] text-gray-400 uppercase tracking-wide">Distribuição</p>
                  {blankDebits.map((d) => (
                    <div key={`${d.user_type}:${d.user_id}`} className="flex justify-between text-[12px]">
                      <span className="text-gray-600">{shortName(d.name)} ({d.identifier}){d.user_type === 'employee' ? ' · Func.' : ''}</span>
                      <span className="font-medium text-gray-800">{d.sheets_to_debit} fls</span>
                    </div>
                  ))}
                </div>
              )}
              {blankDebits.length === 1 && (
                <div className="flex justify-between text-[13px]">
                  <span className="text-gray-500">{blankIdentified.user_type === 'employee' ? 'Funcionário' : 'Aluno'}</span>
                  <span className="font-medium text-gray-900">{shortName(blankIdentified.user.name)}</span>
                </div>
              )}
            </div>

            {wasteError && <p className="text-[13px] text-red-500 mb-3">{wasteError}</p>}

            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => { setBlankDebits(null); setWasteError(''); }}>Voltar</Button>
              <Button size="sm" className="flex-1 justify-center" loading={wasteLoading} onClick={confirmBlankWaste}>
                Registrar folhas em branco
              </Button>
            </div>
          </>
        )}
      </Modal>

      {/* ── Recent operation detail modal ── */}
      <Modal
        open={!!selectedRecent}
        onClose={() => setSelectedRecent(null)}
        title={selectedRecent?.user_type === 'employee' ? 'Detalhes do Funcionário' : 'Detalhes do Aluno'}
        size="xl"
      >
        {recentDetailLoading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : recentStudentDetail && recentFullHistory ? (
          <div className="space-y-5">
            {/* Header */}
            <div className="flex gap-4">
              <div className="shrink-0">
                {recentStudentDetail.photo ? (
                  <img
                    src={`data:image/jpeg;base64,${recentStudentDetail.photo}`}
                    alt={recentStudentDetail.user.name}
                    className="w-16 h-16 rounded-xl object-cover border border-white/60 shadow-sm"
                  />
                ) : recentStudentDetail.user_type === 'employee' ? (
                  <div className="w-16 h-16 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-400">
                    <Briefcase size={24} />
                  </div>
                ) : (
                  <div className="w-16 h-16 rounded-xl bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-400 text-xl font-semibold">
                    {recentStudentDetail.user.name.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-[15px] font-semibold text-gray-900">{recentStudentDetail.user.name}</p>
                  {recentStudentDetail.user_type === 'employee' && (
                    <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100">Funcionário</span>
                  )}
                </div>
                <p className="text-[12px] text-gray-500 mt-0.5">{getUserIdentifier(recentStudentDetail.user, recentStudentDetail.user_type)}</p>
                {(() => {
                  const detail = getUserDetail(recentStudentDetail.user, recentStudentDetail.user_type);
                  return detail ? <p className="text-[12px] text-gray-500">{detail}</p> : null;
                })()}
                {recentStudentDetail.user.sync_status !== 'synced' && (
                  <span className="inline-block mt-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                    {SYNC_STATUS_LABELS[recentStudentDetail.user.sync_status]}
                  </span>
                )}
              </div>
            </div>

            {/* Quota summary */}
            {(() => {
              const totalPrintedToday = recentFullHistory.as_primary.reduce((a, op) => a + op.total_sheets, 0);
              const ownSheetsTotal = recentFullHistory.as_primary.reduce((a, op) => a + op.own_sheets, 0);
              const receivedTotal = recentFullHistory.as_primary.reduce((a, op) => a + op.borrowed_sheets, 0);
              const lentTotal = recentFullHistory.as_lender.reduce((a, e) => a + e.sheets, 0);
              return (
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { label: 'Total impresso', value: totalPrintedToday, icon: <Printer size={13} />, color: 'text-gray-700' },
                    { label: 'Cota própria', value: ownSheetsTotal, icon: <Clock size={13} />, color: 'text-blue-600' },
                    { label: 'Emp. recebido', value: receivedTotal, icon: <TrendingDown size={13} />, color: 'text-amber-600' },
                    { label: 'Cota cedida', value: lentTotal, icon: <TrendingUp size={13} />, color: 'text-emerald-600' },
                  ].map((item) => (
                    <div key={item.label} className="flex flex-col items-center p-3 bg-gray-50/80 rounded-xl border border-gray-100">
                      <span className={`${item.color} mb-1`}>{item.icon}</span>
                      <p className={`text-[18px] font-bold ${item.color}`}>{item.value}</p>
                      <p className="text-[10px] text-gray-500 text-center leading-tight mt-0.5">{item.label}</p>
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* Operations as primary */}
            {recentFullHistory.as_primary.length > 0 && (() => {
              const totalOpsPages = Math.max(1, Math.ceil(recentFullHistory.as_primary.length / 5));
              const safeOpsPage = Math.min(recentModalOpsPage, totalOpsPages);
              const pagedOps = recentFullHistory.as_primary.slice((safeOpsPage - 1) * 5, safeOpsPage * 5);
              return (
                <div>
                  <p className="text-[12px] font-medium text-gray-500 uppercase tracking-wide mb-2">Operações realizadas hoje</p>
                  <div className="space-y-2">
                    {pagedOps.map((op) => (
                      <div key={op.id} className="rounded-xl border border-gray-100 overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-2 bg-gray-50/70 border-b border-gray-100">
                          <span className="text-[12px] text-gray-500">Op. #{op.id} · {formatModalTime(op.created_at)} · {op.operator_login}</span>
                          <span className="text-[13px] font-bold text-gray-900">{op.total_sheets} folhas</span>
                        </div>
                        {op.entries.map((e) => {
                          const isOwn = e.user_id === selectedRecent?.id && e.user_type === selectedRecent?.user_type;
                          const displayName = shortName(e.user_name ?? e.student_name ?? '');
                          return (
                            <div key={e.id} className="flex items-center justify-between px-4 py-2.5 bg-white/60">
                              <div className="flex items-center gap-2">
                                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${isOwn ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>
                                  {isOwn ? 'Própria' : 'Empréstimo'}
                                </span>
                                {!isOwn && (
                                  <p className="text-[12px] font-medium text-gray-800 leading-tight">{displayName}</p>
                                )}
                              </div>
                              <span className="text-[13px] font-semibold text-gray-900 shrink-0">{e.sheets} folhas</span>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                  {totalOpsPages > 1 && (
                    <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-100">
                      <p className="text-[11px] text-gray-400">
                        {(safeOpsPage - 1) * 5 + 1}–{Math.min(safeOpsPage * 5, recentFullHistory.as_primary.length)} de {recentFullHistory.as_primary.length}
                      </p>
                      <div className="flex gap-1">
                        <button onClick={() => setRecentModalOpsPage(Math.max(1, safeOpsPage - 1))} disabled={safeOpsPage === 1}
                          className="px-2 py-1 text-[11px] font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                          Anterior
                        </button>
                        <button onClick={() => setRecentModalOpsPage(Math.min(totalOpsPages, safeOpsPage + 1))} disabled={safeOpsPage === totalOpsPages}
                          className="px-2 py-1 text-[11px] font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                          Próxima
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Loans given */}
            {recentFullHistory.as_lender.length > 0 && (
              <div>
                <p className="text-[12px] font-medium text-gray-500 uppercase tracking-wide mb-2">Cota cedida a outros usuários</p>
                <div className="rounded-xl border border-gray-100 overflow-hidden divide-y divide-gray-100">
                  {recentFullHistory.as_lender.map((e) => (
                    <div key={e.id} className="flex items-center justify-between px-4 py-2.5 bg-white/60">
                      <div>
                        <p className="text-[13px] font-medium text-gray-900">{e.primary_user_name ?? e.primary_student_name}</p>
                        <p className="text-[11px] text-gray-400">{e.primary_user_identifier ?? e.primary_registration} · op. #{e.operation_id}</p>
                      </div>
                      <span className="text-[13px] font-bold text-emerald-700">{e.sheets} folhas</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : null}
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
