import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthProvider';
import { ThemeProvider } from './contexts/ThemeProvider';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { PrintFlowPage } from './pages/PrintFlowPage';
import { TodayPage } from './pages/TodayPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';
import { AdjustEntryPage } from './pages/AdjustEntryPage';

function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />

            <Route
              path="/"
              element={
                <ProtectedRoute roles={['operator', 'admin']}>
                  <Layout><PrintFlowPage /></Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/today"
              element={
                <ProtectedRoute>
                  <Layout><TodayPage /></Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/adjust"
              element={
                <ProtectedRoute roles={['operator', 'admin']}>
                  <Layout><AdjustEntryPage /></Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/reports"
              element={
                <ProtectedRoute roles={['operator', 'auditor', 'admin']}>
                  <Layout><ReportsPage /></Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/settings"
              element={
                <ProtectedRoute roles={['admin']}>
                  <Layout><SettingsPage /></Layout>
                </ProtectedRoute>
              }
            />

            <Route path="*" element={<Navigate to="/today" replace />} />
          </Routes>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

export default App;
