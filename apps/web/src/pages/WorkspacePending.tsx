import { AuthLayout } from '../components/AuthLayout';

export function WorkspacePending() {
  return (
    <AuthLayout title="Workspace pending" subtitle="Payment not yet set up">
      <div className="card" style={{ background: 'var(--bg-white)', maxWidth: '420px' }}>
        <p style={{ color: '#555', marginBottom: '24px', lineHeight: 1.6 }}>
          Your workspace is pending. Talk to your admins for more info.
        </p>
        <p style={{ color: '#888', fontSize: '14px' }}>
          An admin needs to complete payment setup before you can access the app.
        </p>
      </div>
    </AuthLayout>
  );
}
