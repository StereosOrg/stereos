import React from 'react';

/** Cursor logo (from cursor.svg) */
function CursorIcon({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      fill="currentColor"
      fillRule="evenodd"
      height={size}
      width={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0 }}
    >
      <title>Cursor</title>
      <path d="M22.106 5.68L12.5.135a.998.998 0 00-.998 0L1.893 5.68a.84.84 0 00-.419.726v11.186c0 .3.16.577.42.727l9.607 5.547a.999.999 0 00.998 0l9.608-5.547a.84.84 0 00.42-.727V6.407a.84.84 0 00-.42-.726zm-.603 1.176L12.228 22.92c-.063.108-.228.064-.228-.061V12.34a.59.59 0 00-.295-.51l-9.11-5.26c-.107-.062-.063-.228.062-.228h18.55c.264 0 .428.286.296.514z" />
    </svg>
  );
}

const TOOL_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  cursor: CursorIcon,
  'cursor-v1': CursorIcon,
  'cursor-v2': CursorIcon,
};

/** Display name for tool/actor_id (e.g. cursor-v1 → "Cursor") */
const TOOL_DISPLAY_NAMES: Record<string, string> = {
  cursor: 'Cursor',
  'cursor-v1': 'Cursor',
  'cursor-v2': 'Cursor',
  'github-copilot': 'GitHub Copilot',
  'sourcegraph-cody': 'Cody',
  continue: 'Continue',
  supermaven: 'SuperMaven',
  codeium: 'Codeium',
  vscode: 'VS Code',
};

export function toolDisplayName(toolOrActorId: string | null | undefined): string {
  if (!toolOrActorId) return '—';
  const key = toolOrActorId.toLowerCase();
  return TOOL_DISPLAY_NAMES[key] ?? toolOrActorId.charAt(0).toUpperCase() + toolOrActorId.slice(1).toLowerCase();
}

function getToolKey(actorId: string, tool: string): string {
  const id = (actorId || tool || '').toLowerCase();
  if (TOOL_ICONS[id]) return id;
  const toolLower = (tool || '').toLowerCase();
  if (TOOL_ICONS[toolLower]) return toolLower;
  return '';
}

interface ToolIconProps {
  actorId?: string;
  tool?: string;
  size?: number;
  className?: string;
}

export function ToolIcon({ actorId, tool, size = 24, className }: ToolIconProps) {
  const key = getToolKey(actorId ?? '', tool ?? '');
  const Icon = key ? TOOL_ICONS[key] : null;

  if (Icon) {
    return <Icon size={size} className={className} />;
  }

  const letter = (tool || actorId || '?').charAt(0).toUpperCase();
  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: '4px',
        background: 'var(--bg-cream)',
        border: '2px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.round(size * 0.55),
        fontWeight: 700,
        color: 'var(--dark)',
        flexShrink: 0,
      }}
    >
      {letter}
    </div>
  );
}
