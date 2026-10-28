import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Loading } from './components/common';
import { useAuth } from './lib/auth';
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
  return (
    <Routes>
      <Route path="/print/labels" element={<LabelsPrintPage />} />
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
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
