import { ROLE_LABELS, type RoleCode } from '@fabricqc/shared';
import { useQuery } from '@tanstack/react-query';
import {
  ClipboardCheck,
  ClipboardList,
  Cog,
  FileSearch,
  Gauge,
  Layers,
  LogOut,
  Menu,
  Ruler,
  Shirt,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { DropdownContent, DropdownItem, DropdownMenu, DropdownTrigger } from './ui/dropdown';

const ALL: RoleCode[] = ['ADMIN', 'QUALITY_MANAGER', 'QC_SUPERVISOR', 'SALES'];

export const NAV: { to: string; label: string; icon: typeof Gauge; roles: RoleCode[] }[] = [
  { to: '/', label: '工作台', icon: Gauge, roles: ALL },
  { to: '/reviews', label: '审核中心', icon: ClipboardCheck, roles: ['QUALITY_MANAGER', 'QC_SUPERVISOR'] },
  { to: '/tasks', label: '验布任务', icon: ClipboardList, roles: ['ADMIN', 'QUALITY_MANAGER', 'QC_SUPERVISOR', 'SALES'] },
  { to: '/inspections', label: '质检记录', icon: FileSearch, roles: ALL },
  { to: '/rolls', label: '批次与布卷', icon: Layers, roles: ALL },
  { to: '/fabrics', label: '面料与客户', icon: Shirt, roles: ALL },
  { to: '/standards', label: '质量标准', icon: Ruler, roles: ALL },
  { to: '/users', label: '员工与微信', icon: Users, roles: ['ADMIN'] },
  { to: '/settings', label: '系统设置', icon: Cog, roles: ['ADMIN', 'QUALITY_MANAGER'] },
];

export function Layout() {
  const { me, logout, can } = useAuth();
  const [open, setOpen] = useState(false);
  const pending = useQuery({
    queryKey: ['reviews', 'queue', 'count'],
    queryFn: () => api.get<unknown[]>('/reviews/queue').then((r) => r.length),
    enabled: can('QUALITY_MANAGER', 'QC_SUPERVISOR'),
    refetchInterval: 60_000,
  });

  const nav = NAV.filter((n) => can(...n.roles));
  return (
    <div className="flex min-h-screen">
      <aside
        className={cn(
          'no-print fixed inset-y-0 left-0 z-40 w-56 border-r bg-card transition-transform md:static md:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-14 items-center gap-2 border-b px-5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-xs font-bold text-white">QC</div>
          <div>
            <div className="text-sm font-semibold leading-none">FabricQC</div>
            <div className="mt-1 text-[11px] text-muted-foreground">验布管理 Lite</div>
          </div>
        </div>
        <nav className="space-y-0.5 p-3">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
                  isActive ? 'bg-accent font-medium text-accent-foreground' : 'text-foreground/80 hover:bg-secondary',
                )
              }
            >
              <n.icon className="h-4 w-4" />
              <span className="flex-1">{n.label}</span>
              {n.to === '/reviews' && !!pending.data && (
                <span className="rounded-full bg-primary px-1.5 text-[11px] font-medium text-white">{pending.data}</span>
              )}
            </NavLink>
          ))}
        </nav>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setOpen(false)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-20 flex h-14 items-center justify-between border-b bg-card/90 px-4 backdrop-blur md:px-6">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen(true)} aria-label="菜单">
            <Menu />
          </Button>
          <div className="hidden md:block" />
          <DropdownMenu>
            <DropdownTrigger asChild>
              <button className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-secondary">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-xs font-medium text-accent-foreground">
                  {me?.name.slice(0, 1)}
                </div>
                <div className="text-left">
                  <div className="leading-none">{me?.name}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {me?.roles.map((r) => ROLE_LABELS[r.role]).join(' / ')}
                  </div>
                </div>
              </button>
            </DropdownTrigger>
            <DropdownContent>
              <DropdownItem onSelect={() => void logout()}>
                <LogOut className="h-4 w-4" />
                退出登录
              </DropdownItem>
            </DropdownContent>
          </DropdownMenu>
        </header>
        <main className="flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
