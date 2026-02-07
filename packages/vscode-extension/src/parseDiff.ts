/**
 * Parse unified diff output into a JSON-serializable array.
 * Structure: Array<{ path: string, hunks: Array<{ oldStart, oldCount, newStart, newCount, lines }> }>
 */

export type DiffLine = { type: 'add' | 'remove' | 'context'; content: string };
export type DiffHunk = { oldStart: number; oldCount: number; newStart: number; newCount: number; lines: DiffLine[] };
export type FileDiff = { path: string; hunks: DiffHunk[] };
export type DiffJson = FileDiff[];

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseUnifiedDiffToJson(raw: string): DiffJson {
  const files: FileDiff[] = [];
  const lines = raw.split(/\r?\n/);
  let i = 0;
  let currentFile: FileDiff | null = null;
  let currentHunk: DiffHunk | null = null;

  while (i < lines.length) {
    const line = lines[i];
    const diffLine = line.startsWith('\n') ? '' : line;
    const firstChar = diffLine.charAt(0);

    if (diffLine.startsWith('diff --git ')) {
      const match = diffLine.match(/^diff --git a\/(.+?) b\/(.+)$/);
      const path = match ? (match[2] ?? match[1]) : diffLine.replace(/^diff --git a\/| b\/.*$/, '').trim();
      currentFile = { path, hunks: [] };
      files.push(currentFile);
      currentHunk = null;
      i++;
      continue;
    }

    if (currentFile && diffLine.startsWith('@@')) {
      const m = diffLine.match(HUNK_HEADER);
      if (m) {
        currentHunk = {
          oldStart: parseInt(m[1], 10),
          oldCount: parseInt(m[2] ?? '1', 10),
          newStart: parseInt(m[3], 10),
          newCount: parseInt(m[4] ?? '1', 10),
          lines: [],
        };
        currentFile.hunks.push(currentHunk);
      }
      i++;
      continue;
    }

    if (currentHunk) {
      if (firstChar === '+') {
        if (!diffLine.startsWith('+++')) currentHunk.lines.push({ type: 'add', content: diffLine });
      } else if (firstChar === '-') {
        if (!diffLine.startsWith('---')) currentHunk.lines.push({ type: 'remove', content: diffLine });
      } else {
        currentHunk.lines.push({ type: 'context', content: diffLine });
      }
    }

    i++;
  }

  return files;
}
