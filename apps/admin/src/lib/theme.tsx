import { Theme as AstryxTheme, defineTheme } from '@astryxdesign/core/theme';
import { createContext, useContext, useState, type ReactNode } from 'react';

export type Theme = 'light' | 'dark';
const STORAGE_KEY = 'fabricqc-admin-theme';
const workspaceTheme=defineTheme({
 name:'yongsheng-workspace',
 tokens:{
  '--color-accent':['#216bda','#3377d9'],
  '--color-on-accent':'#ffffff',
  '--color-text-accent':['#195fbf','#8ebcff'],
  '--color-background-body':['#f1f4f7','#111112'],
  '--color-background-surface':['#ffffff','#1b1d22'],
  '--color-background-card':['#ffffff','#1b1d22'],
  '--color-text-primary':['#1c3046','#e6edf5'],
  '--color-text-secondary':['#5c6f82','#a7b6c8'],
  '--font-family-body':"-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif",
 },
});

export function readTheme(): Theme {
  try { return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light'; }
  catch { return 'light'; }
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

const ThemeContext = createContext<{ theme: Theme; toggle: () => void } | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readTheme);
  function toggle() {
    const next = theme === 'light' ? 'dark' : 'light';
    applyTheme(next);
    setTheme(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* 当前窗口仍可切换 */ }
  }
  return <ThemeContext.Provider value={{ theme, toggle }}><AstryxTheme theme={workspaceTheme} mode={theme}>{children}</AstryxTheme></ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('ThemeProvider missing');
  return context;
}
