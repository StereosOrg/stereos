interface SplitAuthLayoutProps {
  /** Left panel: product context, trial info, pricing terms */
  leftPanel: React.ReactNode;
  /** Right panel: form or checkout */
  rightPanel: React.ReactNode;
  /** Logo shown above right panel */
  showLogo?: boolean;
  /** Max width of right panel content (default 480) */
  rightPanelMaxWidth?: number;
  /** Vertically center the right panel content */
  centerRightPanel?: boolean;
}

export function SplitAuthLayout({ leftPanel, rightPanel, showLogo = true, rightPanelMaxWidth = 480, centerRightPanel = false }: SplitAuthLayoutProps) {
  return (
    <div
      data-split-auth
      style={{
        height: '100vh',
        minHeight: '100vh',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'row',
        background: '#f8fafc',
      }}
    >
      {/* Left panel: product context, trial info, pricing - gradient background */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '48px 56px',
          overflowY: 'auto',
          overflowX: 'hidden',
          maxWidth: '600px',
          background: 'var(--gradient-auth-left)',
          position: 'relative',
          boxShadow: 'inset -8px 0 24px -12px rgba(0,0,0,0.06)',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '100%',
            background: 'radial-gradient(circle at 20% 50%, rgba(167,243,208,0.4) 0%, transparent 50%), radial-gradient(circle at 80% 80%, rgba(167,243,208,0.3) 0%, transparent 40%)',
            pointerEvents: 'none',
          }}
        />
        <div style={{ position: 'relative', zIndex: 1 }}>{leftPanel}</div>
      </div>

      {/* Right panel: form or checkout - clean white */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-start',
          padding: '32px 48px',
          overflowY: 'auto',
          overflowX: 'hidden',
          background: '#ffffff',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: `${rightPanelMaxWidth}px`,
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: centerRightPanel ? 'center' : 'flex-start',
            overflowY: 'auto',
            overflowX: 'hidden',
          }}
        >
          {centerRightPanel ? (
            <>
              {showLogo && (
                <div
                  data-mobile-logo
                  style={{
                    textAlign: 'center',
                    marginBottom: '12px',
                    flexShrink: 0,
                  }}
                >
                  <img
                    src="/transparent-logo.png"
                    alt="Stereos"
                    style={{ height: '48px', width: 'auto', display: 'inline-block' }}
                  />
                </div>
              )}
              {rightPanel}
            </>
          ) : (
            <>
              {showLogo && (
                <div
                  data-mobile-logo
                  style={{
                    textAlign: 'center',
                    marginBottom: '20px',
                    flexShrink: 0,
                  }}
                >
                  <img
                    src="/transparent-logo.png"
                    alt="Stereos"
                    style={{ height: '48px', width: 'auto', display: 'inline-block' }}
                  />
                </div>
              )}
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                {rightPanel}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Mobile: stack vertically */}
      <style>{`
        @media (max-width: 768px) {
          [data-split-auth] {
            flex-direction: column !important;
          }
          [data-split-auth] > div:first-child {
            padding: 24px 20px !important;
            min-height: auto !important;
          }
          [data-split-auth] > div:last-child {
            padding: 20px 16px !important;
          }
        }
      `}</style>
    </div>
  );
}
