import { StereosLogo } from './StereosLogo';

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
        padding: '24px',
      }}
    >
      <div style={{ width: '100%', maxWidth: `${contentMaxWidth}px` }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '12px',
              marginBottom: '12px',
            }}
          >
            <div
              style={{
                width: '48px',
                height: '48px',
                background: 'var(--dark)',
                border: '3px solid var(--border-color)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '4px 4px 0 var(--border-color)',
              }}
            >
              <StereosLogo size={24} color="white" />
            </div>
            <span style={{ fontSize: '28px', fontWeight: 800 }}>STEREOS</span>
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
