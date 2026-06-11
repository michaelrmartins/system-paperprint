import { ReactNode, useEffect, useState, useCallback } from 'react';
import api from '../lib/api';
import { ThemeContext, Theme } from '../hooks/useTheme';

const THEME_KEY = 'paperprint_theme';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    return (localStorage.getItem(THEME_KEY) as Theme) || 'light';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    api.put('/auth/preferences', { theme: newTheme }).catch(() => {});
  }, []);

  const loadThemeFromServer = useCallback((serverTheme: Theme) => {
    if (serverTheme === 'dark' || serverTheme === 'light') {
      setThemeState(serverTheme);
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, loadThemeFromServer }}>
      {children}
    </ThemeContext.Provider>
  );
}
