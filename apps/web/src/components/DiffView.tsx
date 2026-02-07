/** Structured diff from extension: array of { path, hunks: [{ oldStart, oldCount, newStart, newCount, lines: [{ type, content }] }] } */
type DiffLine = { type: 'add' | 'remove' | 'context'; content: string };
type DiffHunk = { oldStart: number; oldCount: number; newStart: number; newCount: number; lines: DiffLine[] };
type FileDiff = { path: string; hunks: DiffHunk[] };
type DiffJson = FileDiff[];

/**
 * Renders diff_content: either a JSON array of file diffs (new format) or legacy raw unified diff string.
 */
export function DiffView({ content, maxHeight = '400px' }: { content: string; maxHeight?: string }) {
  const containerStyle = {
    margin: 0,
    padding: '12px 16px',
    fontSize: '13px',
    fontFamily: 'ui-monospace, monospace',
    lineHeight: 1.5,
    overflow: 'auto' as const,
    maxHeight,
    border: '2px solid var(--border-color)',
    background: 'var(--bg-cream)',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-all' as const,
  };

  let parsed: DiffJson | null = null;
  try {
    const t = content.trim();
    if (t.startsWith('[')) {
      const p = JSON.parse(content) as unknown;
      if (Array.isArray(p) && p.length > 0) parsed = p as DiffJson;
    }
  } catch {
    parsed = null;
  }

  if (parsed && Array.isArray(parsed) && parsed.length > 0) {
    return (
      <div style={containerStyle}>
        {parsed.map((file, fi) => (
          <div key={fi} style={{ marginBottom: '16px' }}>
            <div style={{ fontWeight: 600, marginBottom: '8px', color: 'var(--dark)' }}>{file.path}</div>
            {file.hunks?.map((hunk, hi) => (
              <div key={hi} style={{ marginBottom: '8px' }}>
                <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>
                  @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@
                </div>
                {hunk.lines?.map((line, li) => (
                  <div
                    key={li}
                    style={{
                      ...(line.type === 'add' && { background: 'rgba(34, 197, 94, 0.15)' }),
                      ...(line.type === 'remove' && { background: 'rgba(239, 68, 68, 0.15)' }),
                    }}
                  >
                    {line.type === 'context' ? ' ' : line.type === 'add' ? '+' : '-'}{line.content || ' '}
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  // Legacy: raw unified diff string
  const lines = content.split('\n');
  return (
    <pre style={containerStyle}>
      {lines.map((line, i) => {
        const isAddition = line.startsWith('+') && !line.startsWith('+++');
        const isDeletion = line.startsWith('-') && !line.startsWith('---');
        return (
          <div
            key={i}
            style={{
              ...(isAddition && { background: 'rgba(34, 197, 94, 0.15)', color: 'var(--dark)' }),
              ...(isDeletion && { background: 'rgba(239, 68, 68, 0.15)', color: 'var(--dark)' }),
            }}
          >
            {line || ' '}
          </div>
        );
      })}
    </pre>
  );
}
