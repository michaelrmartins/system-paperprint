import { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Printer, List, BarChart2, Settings, FileEdit, LogOut } from 'lucide-react';
import { ROLE_LABELS } from '../lib/format';
import { PrinterWidget } from './PrinterWidget';

interface NavItem {
  to: string;
  icon: ReactNode;
  label: string;
  roles?: string[];
}

const navItems: NavItem[] = [
  { to: '/', icon: <Printer size={17} />, label: 'Impressão', roles: ['operator', 'admin'] },
  { to: '/today', icon: <List size={17} />, label: 'Hoje', roles: ['operator', 'auditor', 'admin'] },
  { to: '/adjust', icon: <FileEdit size={17} />, label: 'Ajuste', roles: ['operator', 'admin'] },
  { to: '/reports', icon: <BarChart2 size={17} />, label: 'Relatórios', roles: ['auditor', 'admin'] },
  { to: '/settings', icon: <Settings size={17} />, label: 'Config.', roles: ['admin'] },
];

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const visibleItems = navItems.filter(
    (item) => !item.roles || (user && item.roles.includes(user.role))
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 flex flex-col">
      {/* Top bar */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-xl border-b border-white/60 shadow-glass-sm">
        <div className="max-w-5xl mx-auto px-4 h-12 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gray-900 flex items-center justify-center">
              <Printer size={14} className="text-white" />
            </div>
            <span className="text-[15px] font-semibold text-gray-900 tracking-tight">Paperprint</span>
          </div>

          {user && (
            <div className="flex items-center gap-3">
              <span className="text-[12px] text-gray-500">
                {user.login} · <span className="text-gray-400">{ROLE_LABELS[user.role]}</span>
              </span>
              <button
                onClick={handleLogout}
                className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
                title="Sair"
              >
                <LogOut size={15} />
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="flex flex-1 max-w-5xl mx-auto w-full px-4 py-5 gap-6">
        {/* Sidebar */}
        <nav className="shrink-0 w-44">
          <div className="sticky top-20">
            <ul className="space-y-0.5">
              {visibleItems.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-150 ${
                        isActive
                          ? 'bg-gray-900 text-white shadow-sm'
                          : 'text-gray-600 hover:bg-gray-100/80 hover:text-gray-900'
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
          </div>
        </nav>

        {/* Main content */}
        <main className="flex-1 min-w-0 animate-fadeIn">
          {children}
        </main>
      </div>
    </div>
  );
}
