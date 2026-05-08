import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { extractApiError } from '../lib/errors';
import { Printer } from 'lucide-react';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [loginVal, setLoginVal] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(loginVal, password);
      navigate('/');
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 via-white to-gray-100">
      <div className="w-full max-w-sm animate-slideUp">
        <div className="bg-white/80 backdrop-blur-xl border border-white/60 rounded-3xl shadow-glass p-8">
          <div className="flex flex-col items-center mb-8">
            <div className="w-12 h-12 rounded-2xl bg-gray-900 flex items-center justify-center mb-4 shadow-sm">
              <Printer size={22} className="text-white" />
            </div>
            <h1 className="text-[20px] font-bold text-gray-900 tracking-tight">Paperprint</h1>
            <p className="text-[13px] text-gray-400 mt-1">Controle de impressões</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Usuário"
              value={loginVal}
              onChange={(e) => setLoginVal(e.target.value)}
              placeholder="login"
              autoFocus
              autoComplete="username"
            />
            <Input
              label="Senha"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />

            {error && (
              <p className="text-[13px] text-red-500 text-center animate-fadeIn">{error}</p>
            )}

            <Button
              type="submit"
              loading={loading}
              className="w-full justify-center mt-2"
            >
              Entrar
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
