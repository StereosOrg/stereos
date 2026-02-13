type DiffViewerProps = {
  diff: string;
};

export function DiffViewer({ diff }: DiffViewerProps) {
  const lines = diff.split('\n');
  return (
    <div
      className="card"
      style={{
        padding: '0',
        overflow: 'hidden',
        background: 'var(--bg-white)',
      }}
    >
      <div style={{ padding: '12px 16px', borderBottom: '2px solid var(--border-color)', background: 'var(--bg-cream)', fontWeight: 700 }}>
        Diff
      </div>
      <pre
        style={{
          margin: 0,
          padding: '16px',
          overflowX: 'auto',
          fontSize: '12px',
          lineHeight: 1.5,
          fontFamily: 'monospace',
          background: 'var(--bg-white)',
        }}
      >
        {lines.map((line, idx) => {
          let color = '#1f2937';
          let bg = 'transparent';
          if (line.startsWith('+')) {
            color = '#065f46';
            bg = 'rgba(16, 185, 129, 0.08)';
          } else if (line.startsWith('-')) {
            color = '#991b1b';
            bg = 'rgba(239, 68, 68, 0.08)';
          }
          return (
            <div key={idx} style={{ color, background: bg, padding: '0 4px' }}>
              {line}
            </div>
          );
        })}
      </pre>
    </div>
  );
}
