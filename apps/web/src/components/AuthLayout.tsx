interface AuthLayoutProps {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
  /** Optional max width for content (default 420px). Use e.g. 560 for embedded checkout. */
  contentMaxWidth?: number;
}

export function AuthLayout({ children, title, subtitle, contentMaxWidth = 420 }: AuthLayoutProps) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--gradient-auth-left)',
        padding: '24px',
      }}
    >
      <div style={{ width: '100%', maxWidth: `${contentMaxWidth}px` }}>
        <div style={{ textAlign: 'center', marginBottom: '28px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ marginBottom: '12px' }}>
            <img
              src="/transparent-logo.png"
              alt="Stereos"
              style={{
                height: '56px',
                width: 'auto',
                display: 'block',
                objectFit: 'contain',
              }}
            />
          </div>
          <h1 style={{ fontFamily: "'Sora', sans-serif", fontSize: '22px', fontWeight: 800, marginBottom: '6px', color: '#0f172a' }}>
            {title}
          </h1>
          {subtitle && (
            <p style={{ color: '#64748b', fontSize: '15px', fontWeight: 500 }}>{subtitle}</p>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
