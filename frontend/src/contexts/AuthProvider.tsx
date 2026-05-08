import { useState, useEffect, ReactNode, useCallback } from 'react';
import api from '../lib/api';
import { AuthContext } from '../hooks/useAuth';
import { AuthUser } from '../types';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) { setLoading(false); return; }

    api.get<AuthUser>('/auth/me')
      .then((r) => setUser(r.data))
      .catch(() => {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (loginStr: string, password: string) => {
    const res = await api.post<{ access_token: string; refresh_token: string; user: AuthUser }>(
      '/auth/login', { login: loginStr, password }
    );
    localStorage.setItem('access_token', res.data.access_token);
    localStorage.setItem('refresh_token', res.data.refresh_token);
    setUser(res.data.user);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
