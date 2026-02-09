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
        background: 'var(--bg-mint)',
        padding: '16px',
      }}
    >
      <div style={{ width: '100%', maxWidth: `${contentMaxWidth}px` }}>
        <div style={{ textAlign: 'center', marginBottom: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ marginBottom: '8px' }}>
            <img
              src="/transparent-logo.png"
              alt="Stereos"
              style={{
                height: '64px',
                width: 'auto',
                display: 'block',
                objectFit: 'contain',
              }}
            />
          </div>
          <h1 className="heading-2" style={{ fontSize: '24px', marginBottom: '4px' }}>
            {title}
          </h1>
          {subtitle && (
            <p style={{ color: '#555', fontSize: '15px' }}>{subtitle}</p>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
