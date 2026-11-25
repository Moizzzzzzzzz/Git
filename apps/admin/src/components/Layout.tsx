import { ROLE_LABELS, type RoleCode } from '@fabricqc/shared';
import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck, ClipboardList, Cog, FileSearch, Gauge, Layers, LogOut, Ruler, Shirt, Users } from 'lucide-react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AppShell } from '@astryxdesign/core/AppShell';
import { SideNav, SideNavItem } from '@astryxdesign/core/SideNav';
import { TopNav, TopNavHeading } from '@astryxdesign/core/TopNav';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { Section } from '@astryxdesign/core/Section';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { BUSINESS_ROLES, isBusinessOnly } from '@/lib/business-workflow';
import { ThemeToggle } from './ThemeToggle';
import { DropdownContent, DropdownItem, DropdownMenu, DropdownTrigger } from './ui/dropdown';

const ALL: RoleCode[] = ['ADMIN', 'QUALITY_MANAGER', 'QC_SUPERVISOR'];

export const NAV: { to: string; label: string; icon: typeof Gauge; roles: RoleCode[] }[] = [
  { to: '/notifications', label: '工作通知', icon: ClipboardList, roles: [...BUSINESS_ROLES, 'QC_SUPERVISOR', 'INSPECTOR', 'ADMIN', 'QUALITY_MANAGER'] },
  { to: '/orders', label: 'H 号订单', icon: ClipboardList, roles: [...BUSINESS_ROLES, 'QC_SUPERVISOR', 'INSPECTOR', 'ADMIN', 'QUALITY_MANAGER'] },
  { to: '/business-tasks', label: '历史业务任务', icon: ClipboardList, roles: BUSINESS_ROLES },
  { to: '/', label: '工作台', icon: Gauge, roles: ALL },
  { to: '/reviews', label: '审核中心', icon: ClipboardCheck, roles: ['QUALITY_MANAGER', 'QC_SUPERVISOR'] },
  { to: '/tasks', label: '验布任务', icon: ClipboardList, roles: ['ADMIN', 'QUALITY_MANAGER', 'QC_SUPERVISOR', 'INSPECTOR'] },
  { to: '/inspections', label: '质检记录', icon: FileSearch, roles: ALL },
  { to: '/rolls', label: '批次与布卷', icon: Layers, roles: ALL },
  { to: '/fabrics', label: '面料与客户', icon: Shirt, roles: ALL },
  { to: '/standards', label: '质量标准', icon: Ruler, roles: ALL },
  { to: '/users', label: '员工与微信', icon: Users, roles: ['ADMIN'] },
  { to: '/settings', label: '系统设置', icon: Cog, roles: ['ADMIN', 'QUALITY_MANAGER'] },
];

export function Layout() {
 const { me, logout, can }=useAuth(); const location=useLocation();const navigate=useNavigate();
 const pending=useQuery({queryKey:['reviews','queue','count'],queryFn:()=>api.get<unknown[]>('/reviews/queue').then(r=>r.length),enabled:can('QUALITY_MANAGER','QC_SUPERVISOR'),refetchInterval:60_000});
 if(me&&isBusinessOnly(me.roles.map(r=>r.role))&&!location.pathname.startsWith('/business-tasks')&&!location.pathname.startsWith('/orders')&&!location.pathname.startsWith('/notifications'))return <Navigate to="/orders" replace/>;
 const nav=NAV.filter(n=>can(...n.roles));
 return <AppShell height="auto" variant="section" contentPadding={0}
  topNav={<TopNav label="平台与账户" heading={<TopNavHeading heading="永盛集团质检平台" subheading="管理工作空间"/>} endContent={<HStack gap={3} vAlign="center"><ThemeToggle/><DropdownMenu><DropdownTrigger asChild><button className="account-menu" aria-label="账户菜单"><Text weight="semibold">{me?.name}</Text><Text type="supporting" color="secondary">{me?.roles.map(r=>ROLE_LABELS[r.role]).join(' / ')}</Text></button></DropdownTrigger><DropdownContent><DropdownItem onSelect={()=>void logout()}><LogOut className="h-4 w-4"/>退出登录</DropdownItem></DropdownContent></DropdownMenu></HStack>}/>}
  sideNav={<SideNav aria-label="工作导航">{nav.map(n=><SideNavItem key={n.to} label={n.label} icon={n.icon} href={n.to} isSelected={n.to==='/'?location.pathname==='/':location.pathname.startsWith(n.to)} onClick={e=>{if(!e.metaKey&&!e.ctrlKey&&!e.shiftKey){e.preventDefault();navigate(n.to);}}} endContent={n.to==='/reviews'&&!!pending.data?<Text type="supporting">{pending.data}</Text>:undefined}/>)}</SideNav>}>
  <Section padding={6}><Outlet/></Section>
 </AppShell>;
}
