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

/** Anthropic / Claude logo */
function ClaudeIcon({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0 }}
    >
      <title>Claude</title>
      <path
        d="M15.088 6.412l-4.574 11.09a.396.396 0 01-.378.249.39.39 0 01-.363-.531l4.574-11.09a.396.396 0 01.741.282zM9.266 9.104L5.2 17.345a.396.396 0 01-.73-.305l4.066-8.241a.396.396 0 01.73.305zm5.468 0l4.066 8.241a.396.396 0 01-.73.305l-4.066-8.241a.396.396 0 01.73-.305z"
        fill="#D97757"
      />
    </svg>
  );
}

/** Google Gemini logo */
function GeminiIcon({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0 }}
    >
      <title>Gemini</title>
      <path
        d="M12 2C12 7.524 7.524 12 2 12c5.524 0 10 4.476 10 10 0-5.524 4.476-10 10-10-5.524 0-10-4.476-10-10z"
        fill="url(#gemini_grad)"
      />
      <defs>
        <linearGradient id="gemini_grad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4285F4" />
          <stop offset="1" stopColor="#A855F7" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** Kilo Code logo */
function KiloCodeIcon({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0 }}
    >
      <title>Kilo Code</title>
      <rect x="2" y="2" width="20" height="20" rx="4" fill="#1a1a2e" />
      <text x="12" y="16" textAnchor="middle" fill="#00d4aa" fontSize="12" fontWeight="800" fontFamily="monospace">K</text>
    </svg>
  );
}

/** OpenAI logo */
function OpenAIIcon({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0 }}
    >
      <title>OpenAI</title>
      <path
        d="M22.282 9.821a5.985 5.985 0 00-.516-4.91 6.046 6.046 0 00-6.51-2.9A6.065 6.065 0 0011.17.178a6.046 6.046 0 00-5.764 4.13 5.985 5.985 0 00-3.998 2.9 6.046 6.046 0 00.743 7.097 5.98 5.98 0 00.516 4.911 6.046 6.046 0 006.51 2.9A6.06 6.06 0 0012.83 23.82a6.046 6.046 0 005.764-4.13 5.985 5.985 0 003.998-2.9 6.046 6.046 0 00-.743-7.097"
        fill="currentColor"
      />
    </svg>
  );
}

// ── Vendor icons for Tool Profiles ─────────────────────────────────────

const VENDOR_LOGOS: Record<string, string | React.ComponentType<{ size?: number; className?: string }>> = {
  'cloudflare-workers': 'https://assets.streamlinehq.com/image/private/w_300,h_300,ar_1/f_auto/v1/icons/1/cloudflare-workers-icon-jsii6pml8tdp4sy8kgarwe.png/cloudflare-workers-icon-gfyr5fw7aqcwsa1on45oem.png?_a=DATAiZAAZAA0',
  codex: 'https://images.icon-icons.com/3913/PNG/512/openai_logo_icon_248315.png',
  cursor: CursorIcon,
  vscode: '/vendors/vscode.svg',
  arcade: '/vendors/arcade.svg',
  e2b: '/vendors/e2b.svg',
  anthropic: ClaudeIcon,
  'google-gemini': GeminiIcon,
  openai: OpenAIIcon,
  'kilo-code': KiloCodeIcon,
};

// ── LLM Provider metadata for the LLM-focused detail view ──────────────

export interface LLMProviderInfo {
  slug: string;
  displayName: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  color: string;
}

export const LLM_PROVIDERS: LLMProviderInfo[] = [
  { slug: 'anthropic', displayName: 'Claude', icon: ClaudeIcon, color: '#D97757' },
  { slug: 'google-gemini', displayName: 'Gemini', icon: GeminiIcon, color: '#4285F4' },
  { slug: 'openai', displayName: 'OpenAI', icon: OpenAIIcon, color: '#10a37f' },
  { slug: 'kilo-code', displayName: 'Kilo Code', icon: KiloCodeIcon, color: '#00d4aa' },
];

interface VendorIconProps {
  vendor: string;
  displayName?: string;
  size?: number;
  className?: string;
}

export function VendorIcon({ vendor, displayName, size = 32, className }: VendorIconProps) {
  const logo = VENDOR_LOGOS[vendor];

  if (typeof logo === 'string') {
    return (
      <img
        src={logo}
        alt={displayName || vendor}
        className={className}
        style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0 }}
      />
    );
  }

  if (typeof logo === 'function') {
    const Icon = logo;
    return <Icon size={size} className={className} />;
  }

  // Letter-badge fallback
  const letter = (displayName || vendor || '?').charAt(0).toUpperCase();
  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: '6px',
        background: 'var(--bg-lavender)',
        border: '2px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.round(size * 0.5),
        fontWeight: 800,
        color: 'var(--dark)',
        flexShrink: 0,
      }}
    >
      {letter}
    </div>
  );
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
