import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Dashboard } from './pages/Dashboard';
import { Settings } from './pages/Settings';
import { UsersList } from './pages/UsersList';
import { Onboarding } from './pages/Onboarding';
import { PaymentSuccess } from './pages/PaymentSuccess';
import { StartTrial } from './pages/StartTrial';
import { WorkspacePending } from './pages/WorkspacePending';
import { SignIn } from './pages/SignIn';
import { SignUp } from './pages/SignUp';
import { VerifyEmail } from './pages/VerifyEmail';
import { AcceptInvite } from './pages/AcceptInvite';
import { AuthCallback } from './pages/AuthCallback';
import { VerifyMagic } from './pages/VerifyMagic';
import { Billing } from './pages/Billing';
import { IndividualProfile } from './pages/IndividualProfile';
import { KeyDetail } from './pages/KeyDetail';
import { KeyManagement } from './pages/KeyManagement';
import { Guardrails } from './pages/Guardrails';
import { DiffDetail } from './pages/DiffDetail';
import { TeamProfile } from './pages/TeamProfile';
import { Teams } from './pages/Teams';

function ProtectedLayout() {
  return (
    <ProtectedRoute>
      <Layout />
    </ProtectedRoute>
  );
}

function App() {
  return (
    <Routes>
      {/* Auth routes */}
      <Route path="/auth/sign-in" element={<SignIn />} />
      <Route path="/auth/sign-up" element={<SignUp />} />
      <Route path="/auth/verify-email" element={<VerifyEmail />} />
      <Route path="/auth/accept-invite" element={<AcceptInvite />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/auth/verify-magic" element={<VerifyMagic />} />
      <Route path="/auth/login" element={<Navigate to="/auth/sign-in" replace />} />
      <Route path="/auth/*" element={<Navigate to="/auth/sign-in" replace />} />
      
      {/* Onboarding routes - accessible during onboarding */}
      <Route path="/onboarding" element={<Onboarding />} />
      <Route path="/onboarding/payment-success" element={<PaymentSuccess />} />
      <Route path="/onboarding/start-trial" element={<StartTrial />} />
      <Route path="/onboarding/pending" element={<WorkspacePending />} />

      {/* Protected routes with Layout - require auth + onboarding + payment */}
      <Route path="/" element={<ProtectedLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="keys/:hash" element={<KeyDetail />} />
        <Route path="keys" element={<KeyManagement />} />
        <Route path="guardrails" element={<Guardrails />} />
        <Route path="billing" element={<Billing />} />
        <Route path="individual-profile" element={<IndividualProfile />} />
        <Route path="diffs/:spanId" element={<DiffDetail />} />
        <Route path="teams" element={<Teams />} />
        <Route path="teams/:teamId" element={<TeamProfile />} />
        <Route path="settings" element={<Settings />} />
        <Route path="users" element={<UsersList />} />
        <Route path="users/:userId" element={<IndividualProfile />} />
      </Route>

      {/* Catch all - redirect to home */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
