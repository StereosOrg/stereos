import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Dashboard } from './pages/Dashboard';
import { ProvenanceView } from './pages/ProvenanceView';
import { EventsSearch } from './pages/EventsSearch';
import { EventDetail } from './pages/EventDetail';
import { Settings } from './pages/Settings';
import { UsersList } from './pages/UsersList';
import { UserProfile } from './pages/UserProfile';
import { Onboarding } from './pages/Onboarding';
import { PaymentSuccess } from './pages/PaymentSuccess';
import { StartTrial } from './pages/StartTrial';
import { WorkspacePending } from './pages/WorkspacePending';
import { SignIn } from './pages/SignIn';
import { SignUp } from './pages/SignUp';
import { VerifyEmail } from './pages/VerifyEmail';
import { AcceptInvite } from './pages/AcceptInvite';
import { AuthCallback } from './pages/AuthCallback';

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
        <Route path="provenance" element={<ProvenanceView />} />
        <Route path="events" element={<EventsSearch />} />
        <Route path="events/:eventId" element={<EventDetail />} />
        <Route path="settings" element={<Settings />} />
        <Route path="users" element={<UsersList />} />
        <Route path="users/:userId" element={<UserProfile />} />
      </Route>

      {/* Catch all - redirect to home */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
