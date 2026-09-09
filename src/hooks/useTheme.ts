import { useEffect, useState } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'blw-theme';

function resolveTheme(theme: ThemeChoice): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemeChoice>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
  });

  useEffect(() => {
    const root = document.documentElement;
    const applied = resolveTheme(theme);
    root.dataset.theme = applied;
    root.classList.toggle('dark', applied === 'dark');
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  return { theme, setTheme };
}
