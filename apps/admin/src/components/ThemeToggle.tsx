import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/lib/theme';
import { Button } from './ui/button';

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const label = theme === 'light' ? '切换深色' : '切换浅色';
  return <Button type="button" variant="ghost" size="sm" onClick={toggle} aria-label={label} title={label}>
    {theme === 'light' ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
    <span className="hidden sm:inline">{label}</span>
  </Button>;
}
