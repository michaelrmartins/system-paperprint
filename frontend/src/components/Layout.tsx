import { ReactNode, useState, useEffect, useCallback } from 'react';
import { NavLink, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';
import { Printer, List, BarChart2, Settings, FileEdit, LogOut, Sun, Moon, KeyRound, ChevronDown } from 'lucide-react';
import { ROLE_LABELS } from '../lib/format';
import { PrinterWidget } from './PrinterWidget';
import { Modal } from './Modal';
import { Button } from './Button';
import { Input } from './Input';
import { extractApiError } from '../lib/errors';
import api from '../lib/api';

const APP_VERSION = '2.0.0';

function LyceumStatus() {
  const [available, setAvailable] = useState<boolean | null>(null);

  const check = useCallback(async () => {
    try {
      const res = await api.get<{ available: boolean }>('/health/lyceum');
      setAvailable(res.data.available);
    } catch {
      setAvailable(false);
    }
  }, []);

  useEffect(() => {
    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, [check]);

  if (available === null) return null;

  return (
    <div
      className="mt-3 flex items-center gap-2 px-3 py-2 rounded-xl cursor-default"
      title={available ? 'Lyceum disponível' : 'Sistema em modo de Contingência'}
    >
      <span className={`shrink-0 w-2 h-2 rounded-full ${available ? 'bg-emerald-500' : 'bg-amber-400'}`} />
      <span className={`text-[12px] font-medium ${available ? 'text-gray-400 dark:text-gray-500' : 'text-amber-600'}`}>
        Lyceum
      </span>
    </div>
  );
}

interface NasajonHealth {
  reachable: boolean;
  status: 'ok' | 'degraded' | 'down';
  database: 'up' | 'down' | null;
  redis: 'up' | 'down' | null;
}

function NasajonStatus() {
  const [health, setHealth] = useState<NasajonHealth | null>(null);

  const check = useCallback(async () => {
    try {
      const res = await api.get<NasajonHealth>('/health/nasajon');
      setHealth(res.data);
    } catch {
      setHealth({ reachable: false, status: 'down', database: null, redis: null });
    }
  }, []);

  useEffect(() => {
    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, [check]);

  if (health === null) return null;

  const dotColor =
    health.status === 'ok' ? 'bg-emerald-500' :
    health.status === 'degraded' ? 'bg-amber-400' :
    'bg-red-400';

  const labelColor =
    health.status === 'ok' ? 'text-gray-400 dark:text-gray-500' :
    health.status === 'degraded' ? 'text-amber-600' :
    'text-red-500';

  const downServices = [
    health.database === 'down' && 'database',
    health.redis === 'down' && 'redis',
  ].filter(Boolean).join(', ');

  const tooltip =
    health.status === 'ok' ? 'Nasajon disponível' :
    health.status === 'degraded' ? `Nasajon degradado — ${downServices} indisponível` :
    'Nasajon indisponível';

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-xl cursor-default"
      title={tooltip}
    >
      <span className={`shrink-0 w-2 h-2 rounded-full ${dotColor}`} />
      <span className={`text-[12px] font-medium ${labelColor}`}>
        Nasajon{health.status === 'degraded' && downServices ? ` (${downServices})` : ''}
      </span>
    </div>
  );
}

interface NavItem {
  to: string;
  icon: ReactNode;
  label: string;
  roles?: string[];
}

const navItems: NavItem[] = [
  { to: '/', icon: <Printer size={19} />, label: 'Impressão', roles: ['operator', 'admin'] },
  { to: '/today', icon: <List size={19} />, label: 'Hoje', roles: ['operator', 'auditor', 'admin'] },
  { to: '/adjust', icon: <FileEdit size={19} />, label: 'Ajuste', roles: ['operator', 'admin'] },
  { to: '/reports', icon: <BarChart2 size={19} />, label: 'Relatórios', roles: ['operator', 'auditor', 'admin'] },
  { to: '/settings', icon: <Settings size={19} />, label: 'Config.', roles: ['admin'] },
];

function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const reset = () => {
    setCurrent(''); setNext(''); setConfirm(''); setError(''); setSuccess(false);
  };

  const handleClose = () => { reset(); onClose(); };

  const submit = async () => {
    if (!current || !next || !confirm) { setError('Preencha todos os campos.'); return; }
    if (next !== confirm) { setError('Nova senha e confirmação não coincidem.'); return; }
    if (next.length < 8) { setError('A nova senha deve ter pelo menos 8 caracteres.'); return; }
    setLoading(true);
    setError('');
    try {
      await api.post('/auth/change-password', { current_password: current, new_password: next });
      setSuccess(true);
      setTimeout(handleClose, 1500);
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title="Alterar Senha" size="sm">
      {success ? (
        <p className="text-[15px] text-emerald-600 text-center py-4 font-medium">Senha alterada com sucesso!</p>
      ) : (
        <div className="space-y-4">
          <Input
            label="Senha atual"
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoFocus
          />
          <Input
            label="Nova senha"
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
          <Input
            label="Confirmar nova senha"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          {error && <p className="text-[14px] text-red-500">{error}</p>}
          <div className="flex gap-2 pt-1">
            <Button variant="secondary" size="sm" onClick={handleClose}>Cancelar</Button>
            <Button onClick={submit} loading={loading} className="flex-1 justify-center" size="sm">
              Salvar
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const visibleItems = navItems.filter(
    (item) => !item.roles || (user && item.roles.includes(user.role))
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 flex flex-col">
      {/* Top bar */}
      <header className="sticky top-0 z-40 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border-b border-white/60 dark:border-white/10 shadow-glass-sm dark:shadow-glass-sm-dark">
        <div className="max-w-6xl mx-auto px-5 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
            <div className="w-8 h-8 rounded-xl bg-gray-900 dark:bg-white flex items-center justify-center">
              <Printer size={16} className="text-white dark:text-gray-900" />
            </div>
            <span className="text-[16px] font-semibold text-gray-900 dark:text-white tracking-tight">Paperprint</span>
          </Link>

          {user && (
            <div className="flex items-center gap-2">
              {/* Theme toggle */}
              <button
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="p-2 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 rounded-xl hover:bg-gray-100/80 dark:hover:bg-gray-800/80 transition-colors"
                title={theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
              >
                {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
              </button>

              {/* User menu */}
              <div className="relative">
                <button
                  onClick={() => setUserMenuOpen((v) => !v)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-xl hover:bg-gray-100/80 dark:hover:bg-gray-800/80 transition-colors"
                >
                  <span className="text-[14px] text-gray-700 dark:text-gray-300">
                    {user.login}
                  </span>
                  <span className="text-[12px] text-gray-400 dark:text-gray-500">{ROLE_LABELS[user.role]}</span>
                  <ChevronDown size={14} className="text-gray-400 dark:text-gray-500" />
                </button>

                {userMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setUserMenuOpen(false)} />
                    <div className="absolute right-0 top-full mt-1 z-20 w-52 bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl border border-gray-200 dark:border-gray-700 rounded-xl shadow-glass dark:shadow-glass-dark overflow-hidden animate-scaleIn">
                      <button
                        onClick={() => { setUserMenuOpen(false); setChangePasswordOpen(true); }}
                        className="w-full flex items-center gap-3 px-4 py-3 text-[14px] text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors text-left"
                      >
                        <KeyRound size={16} className="text-gray-400 dark:text-gray-500" />
                        Alterar senha
                      </button>
                      <div className="border-t border-gray-100 dark:border-gray-800" />
                      <button
                        onClick={() => { setUserMenuOpen(false); handleLogout(); }}
                        className="w-full flex items-center gap-3 px-4 py-3 text-[14px] text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors text-left"
                      >
                        <LogOut size={16} />
                        Sair
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </header>

      <div className="flex flex-1 max-w-6xl mx-auto w-full px-5 py-6 gap-7">
        {/* Sidebar */}
        <nav className="shrink-0 w-48">
          <div className="sticky top-20">
            <ul className="space-y-1">
              {visibleItems.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-4 py-3 rounded-xl text-[14px] font-medium transition-all duration-150 ${
                        isActive
                          ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 shadow-sm'
                          : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100/80 dark:hover:bg-gray-800/80 hover:text-gray-900 dark:hover:text-white'
                      }`
                    }
                  >
                    {item.icon}
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
            <PrinterWidget />
            <LyceumStatus />
            <NasajonStatus />
          </div>
        </nav>

        {/* Main content */}
        <main className="flex-1 min-w-0 animate-fadeIn">
          {children}
        </main>
      </div>

      {/* Version watermark */}
      <div className="fixed bottom-3 right-4 z-30 pointer-events-none">
        <span className="text-[11px] text-gray-300 dark:text-gray-700 font-medium select-none">
          v{APP_VERSION}
        </span>
      </div>

      <ChangePasswordModal open={changePasswordOpen} onClose={() => setChangePasswordOpen(false)} />
    </div>
  );
}
