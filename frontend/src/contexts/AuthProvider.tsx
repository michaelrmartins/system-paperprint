import { useState, useEffect, ReactNode, useCallback } from 'react';
import api from '../lib/api';
import { AuthContext } from '../hooks/useAuth';
import { AuthUser } from '../types';
import { useTheme, Theme } from '../hooks/useTheme';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const { loadThemeFromServer } = useTheme();

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) { setLoading(false); return; }

    api.get<AuthUser>('/auth/me')
      .then((r) => {
        setUser(r.data);
        return api.get<{ theme?: Theme }>('/auth/preferences');
      })
      .then((r) => {
        if (r.data.theme) loadThemeFromServer(r.data.theme);
      })
      .catch(() => {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
      })
      .finally(() => setLoading(false));
  }, [loadThemeFromServer]);

  const login = useCallback(async (loginStr: string, password: string) => {
    const res = await api.post<{ access_token: string; refresh_token: string; user: AuthUser }>(
      '/auth/login', { login: loginStr, password }
    );
    localStorage.setItem('access_token', res.data.access_token);
    localStorage.setItem('refresh_token', res.data.refresh_token);
    setUser(res.data.user);
    try {
      const prefRes = await api.get<{ theme?: Theme }>('/auth/preferences');
      if (prefRes.data.theme) loadThemeFromServer(prefRes.data.theme);
    } catch {}
  }, [loadThemeFromServer]);

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
