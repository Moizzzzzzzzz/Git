import {NotificationsPage} from './pages/NotificationsPage';
import {OrdersPage} from './pages/OrdersPage';
import {OrderEditPage} from './pages/OrderEditPage';
import {OrderDetailPage} from './pages/OrderDetailPage';
import {OrderImportPage} from './pages/OrderImportPage';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Loading } from './components/common';
import { useAuth } from './lib/auth';
import { homePathForRoles } from './lib/business-workflow';
import { BusinessCreatePage, BusinessTaskPage, BusinessTasksPage } from './pages/BusinessTasksPage';
import { DashboardPage } from './pages/DashboardPage';
import { FabricsPage } from './pages/FabricsPage';
import { InspectionDetailPage } from './pages/InspectionDetailPage';
import { InspectionsPage } from './pages/InspectionsPage';
import { LabelsPrintPage } from './pages/LabelsPrintPage';
import { LoginPage } from './pages/LoginPage';
import { ReviewsPage } from './pages/ReviewsPage';
import { RollHistoryPage } from './pages/RollHistoryPage';
import { RollsPage } from './pages/RollsPage';
import { SettingsPage } from './pages/SettingsPage';
import { StandardDetailPage } from './pages/StandardDetailPage';
import { StandardsPage } from './pages/StandardsPage';
import { TaskDetailPage } from './pages/TaskDetailPage';
import { TasksPage } from './pages/TasksPage';
import { UsersPage } from './pages/UsersPage';

export function App() {
  const { me, loading } = useAuth();
  if (loading) return <Loading text="正在恢复登录状态…" />;
  if (!me) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }
  const homePath = homePathForRoles(me.roles.map(r => r.role));
  return (
    <Routes>
      <Route path="/print/labels" element={<LabelsPrintPage />} />
      <Route element={<Layout />}>
        <Route index element={homePath === '/' ? <DashboardPage /> : <Navigate to={homePath} replace />} />
        <Route path="notifications" element={<NotificationsPage/>}/>
        <Route path="orders" element={<OrdersPage/>}/>
        <Route path="orders/new" element={<OrderEditPage/>}/>
        <Route path="orders/import" element={<OrderImportPage/>}/>
        <Route path="orders/:id" element={<OrderDetailPage/>}/>
        <Route path="orders/:id/edit" element={<OrderEditPage/>}/>
        <Route path="business-tasks" element={<BusinessTasksPage />} />
        <Route path="business-tasks/new" element={me.roles.some(r => r.role === 'SALES') ? <BusinessCreatePage /> : <Navigate to="/business-tasks" replace />} />
        <Route path="business-tasks/:id" element={<BusinessTaskPage />} />
        <Route path="reviews" element={<ReviewsPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="tasks/:id" element={<TaskDetailPage />} />
        <Route path="inspections" element={<InspectionsPage />} />
        <Route path="inspections/:id" element={<InspectionDetailPage />} />
        <Route path="rolls" element={<RollsPage />} />
        <Route path="rolls/:id/history" element={<RollHistoryPage />} />
        <Route path="fabrics" element={<FabricsPage />} />
        <Route path="standards" element={<StandardsPage />} />
        <Route path="standards/:id" element={<StandardDetailPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
