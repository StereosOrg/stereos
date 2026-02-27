# AI Gateway Tab Layout + Tool Connection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a tab layout to the "Example Requests" card in AIGateway.tsx with an "API" tab (existing content) and a "Tool Connection" tab showing animated Kilo Code setup instructions.

**Architecture:** Single file change to `AIGateway.tsx` plus a small CSS addition to `neobrutalist.css`. The Tool Connection tab has a two-column layout: numbered steps on the left, an animated dark mock panel on the right mimicking the Kilo Code settings sidebar. Animation uses React useState/useEffect for a typewriter cycling effect through 6 setup steps.

**Tech Stack:** React, TypeScript, existing Tabs component (Radix UI) at `apps/web/src/components/ui/tabs.tsx`, CSS keyframes for cursor blink.

---

### Task 1: Add imports and wrap Example Requests in tabs

**Files:**
- Modify: `apps/web/src/pages/AIGateway.tsx`

**Step 1: Update imports at line 1**

Replace the existing import block with:

```tsx
import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { API_BASE, getAuthHeaders } from '../lib/api';
import { Cloud, CheckCircle, AlertCircle, Copy, Check, ChevronDown } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
```

**Step 2: Wrap the "Example Requests" section in Tabs**

The existing full-width card (currently at lines 316–389) starts with:
```tsx
{isProvisioned && (
  <div style={{ ...cardStyle, gridColumn: '1 / -1' }}>
    {/* Inline selector row */}
    <div style={{ display: 'flex', ...
```

Replace that entire block with this structure (move all existing card JSX inside the API TabsContent verbatim):

```tsx
{isProvisioned && (
  <div style={{ ...cardStyle, gridColumn: '1 / -1' }}>
    <Tabs defaultValue="api">
      <TabsList className="settings-subtabs-list" style={{ marginBottom: '20px' }}>
        <TabsTrigger value="api" className="settings-subtabs-trigger">API</TabsTrigger>
        <TabsTrigger value="tool-connection" className="settings-subtabs-trigger">Tool Connection</TabsTrigger>
      </TabsList>

      <TabsContent value="api" style={{ marginTop: 0 }}>
        {/* === PASTE ALL EXISTING CARD INNER JSX HERE VERBATIM === */}
        {/* (the inline selector row div, the description p, and the code block div) */}
      </TabsContent>

      <TabsContent value="tool-connection" style={{ marginTop: 0 }}>
        <p>Coming soon</p>
      </TabsContent>
    </Tabs>
  </div>
)}
```

**Step 3: Verify tabs render**

Open the AI Gateway page, provision a gateway, confirm two tabs "API" and "Tool Connection" appear, API tab shows existing code snippet, Tool Connection tab shows "Coming soon".

**Step 4: Commit**

```bash
git add apps/web/src/pages/AIGateway.tsx
git commit -m "feat: add API/Tool Connection tab wrapper to gateway page"
```

---

### Task 2: Add static data and animation state

**Files:**
- Modify: `apps/web/src/pages/AIGateway.tsx`

**Step 1: Add KILO_STEPS constant outside the component**

Add this directly above the `AIGateway` function declaration:

```tsx
const KILO_STEPS: { label: string; field: string }[] = [
  { label: 'Open Kilo Code → click the Settings icon', field: 'panel' },
  { label: 'Set API Provider to OpenAI Compatible', field: 'provider' },
  { label: 'Paste your gateway URL into Base URL', field: 'baseUrl' },
  { label: 'Paste your virtual key into API Key', field: 'apiKey' },
  { label: 'Set Model (e.g. openai/gpt-4o)', field: 'model' },
  { label: 'Add Custom Header: Content-Type: application/json', field: 'headers' },
];
```

**Step 2: Add animation state inside the AIGateway component**

Add after the existing `useState` declarations (near lines 118–124):

```tsx
const [toolStep, setToolStep] = useState(0);
const [typedText, setTypedText] = useState('');
const typingRef = useRef<ReturnType<typeof setInterval> | null>(null);
```

**Step 3: Compute step values (depends on proxyUrl)**

`proxyUrl` is already computed at line 202 as:
```tsx
const proxyUrl = data?.proxy_url || data?.inference_url || `${API_BASE}/v1`;
```

Add this immediately after that line:

```tsx
const stepValues = useMemo(
  () => ['', 'OpenAI Compatible', proxyUrl, 'vk_••••••••••••', 'openai/gpt-4o', 'application/json'],
  [proxyUrl],
);
```

**Step 4: Add step cycling useEffect**

Add after the `stepValues` declaration:

```tsx
useEffect(() => {
  const timer = setInterval(() => {
    setToolStep(s => (s + 1) % KILO_STEPS.length);
    setTypedText('');
  }, 2800);
  return () => clearInterval(timer);
}, []);
```

**Step 5: Add typewriter useEffect**

```tsx
useEffect(() => {
  if (typingRef.current) clearInterval(typingRef.current);
  const value = stepValues[toolStep];
  if (!value) return;
  let i = 0;
  typingRef.current = setInterval(() => {
    i++;
    setTypedText(value.slice(0, i));
    if (i >= value.length && typingRef.current) clearInterval(typingRef.current);
  }, 35);
  return () => {
    if (typingRef.current) clearInterval(typingRef.current);
  };
}, [toolStep, stepValues]);
```

**Step 6: Commit**

```bash
git add apps/web/src/pages/AIGateway.tsx
git commit -m "feat: add typewriter animation state for tool connection tab"
```

---

### Task 3: Build KiloCodeLogo and KiloMockPanel components

**Files:**
- Modify: `apps/web/src/pages/AIGateway.tsx` — add above the `KILO_STEPS` constant

**Step 1: Add KiloCodeLogo component**

```tsx
function KiloCodeLogo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="3" fill="#E8D000" />
      {/* Left column of K */}
      <rect x="4" y="4" width="4" height="4" fill="#1a1a2e" />
      <rect x="4" y="10" width="4" height="4" fill="#1a1a2e" />
      <rect x="4" y="16" width="4" height="4" fill="#1a1a2e" />
      {/* Top arm of K */}
      <rect x="10" y="4" width="4" height="4" fill="#1a1a2e" />
      {/* Middle of K (implied by gap) */}
      {/* Bottom arm of K */}
      <rect x="10" y="16" width="4" height="4" fill="#1a1a2e" />
      <rect x="16" y="10" width="4" height="4" fill="#1a1a2e" />
      <rect x="16" y="16" width="4" height="4" fill="#1a1a2e" />
    </svg>
  );
}
```

**Step 2: Add KiloMockPanel component**

Add immediately after `KiloCodeLogo`:

```tsx
interface KiloMockPanelProps {
  toolStep: number;
  typedText: string;
  proxyUrl: string;
}

function KiloMockPanel({ toolStep, typedText, proxyUrl }: KiloMockPanelProps) {
  const fields = ['panel', 'provider', 'baseUrl', 'apiKey', 'model', 'headers'];
  const fullValues: Record<string, string> = {
    panel: '',
    provider: 'OpenAI Compatible',
    baseUrl: proxyUrl,
    apiKey: 'vk_••••••••••••',
    model: 'openai/gpt-4o',
    headers: 'application/json',
  };

  const activeField = fields[toolStep];

  const displayValue = (field: string) => {
    const idx = fields.indexOf(field);
    if (toolStep > idx) return fullValues[field];
    if (toolStep === idx) return typedText;
    return '';
  };

  const isActive = (field: string) => activeField === field;

  const mockField = (field: string): React.CSSProperties => ({
    padding: '7px 10px',
    background: isActive(field) ? 'rgba(232,208,0,0.10)' : '#2a2a3e',
    border: `1px solid ${isActive(field) ? '#e8d000' : '#3a3a5e'}`,
    borderRadius: '6px',
    fontSize: '12px',
    fontFamily: 'monospace',
    color: '#e0e0e0',
    minHeight: '30px',
    display: 'flex',
    alignItems: 'center',
    transition: 'all 0.3s ease',
    overflow: 'hidden',
  });

  const label: React.CSSProperties = {
    fontSize: '11px',
    fontWeight: 600,
    color: '#666',
    marginBottom: '4px',
    marginTop: '12px',
    letterSpacing: '0.02em',
  };

  const cursor = <span className="kilo-cursor">|</span>;

  const val = (field: string, full: string, placeholder: string) => {
    const v = displayValue(field);
    return v
      ? <>{v}{isActive(field) && cursor}</>
      : <span style={{ color: '#444' }}>{placeholder}</span>;
  };

  return (
    <div style={{ background: '#1e1e2e', borderRadius: '10px', overflow: 'hidden', border: '1px solid #2a2a3e' }}>
      {/* Header */}
      <div style={{ background: '#181825', padding: '10px 16px', borderBottom: '1px solid #2a2a3e', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <KiloCodeLogo size={16} />
        <span style={{ fontWeight: 700, color: '#cdd6f4', fontSize: '13px' }}>Kilo Code — Providers</span>
      </div>

      <div style={{ padding: '16px' }}>
        {/* Config profile — always shown, never animated */}
        <div style={label}>Configuration Profile</div>
        <div style={{ ...mockField('panel'), color: '#555' }}>default (Active) ▾</div>

        <div style={label}>API Provider</div>
        <div style={mockField('provider')}>
          {val('provider', 'OpenAI Compatible', 'Select provider...')}
          {displayValue('provider') && !isActive('provider') && <span style={{ marginLeft: 'auto', color: '#888' }}> ▾</span>}
        </div>

        <div style={label}>Base URL</div>
        <div style={mockField('baseUrl')}>
          {val('baseUrl', proxyUrl, 'https://...')}
        </div>

        <div style={label}>API Key</div>
        <div style={mockField('apiKey')}>
          {val('apiKey', 'vk_••••••••••••', 'Enter key...')}
        </div>

        <div style={label}>Model</div>
        <div style={mockField('model')}>
          {val('model', 'openai/gpt-4o', 'Select model...')}
          {displayValue('model') && !isActive('model') && <span style={{ marginLeft: 'auto', color: '#888' }}> ▾</span>}
        </div>

        <div style={{ ...label, display: 'flex', justifyContent: 'space-between' }}>
          <span>Custom Headers</span>
          <span style={{ color: '#555', fontSize: '14px', cursor: 'default' }}>+</span>
        </div>
        <div style={{
          background: isActive('headers') ? 'rgba(232,208,0,0.08)' : '#2a2a3e',
          border: `1px solid ${isActive('headers') ? '#e8d000' : '#3a3a5e'}`,
          borderRadius: '6px',
          overflow: 'hidden',
          transition: 'all 0.3s ease',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
            <div style={{ padding: '6px 10px', fontSize: '12px', fontFamily: 'monospace', color: '#888', borderRight: '1px solid #3a3a5e' }}>Authorization</div>
            <div style={{ padding: '6px 10px', fontSize: '12px', fontFamily: 'monospace', color: '#e0e0e0' }}>Bearer •••</div>
            <div style={{ padding: '6px 10px', fontSize: '12px', fontFamily: 'monospace', color: '#888', borderRight: '1px solid #3a3a5e', borderTop: '1px solid #3a3a5e' }}>Content-Type</div>
            <div style={{ padding: '6px 10px', fontSize: '12px', fontFamily: 'monospace', color: '#e0e0e0', borderTop: '1px solid #3a3a5e', display: 'flex', alignItems: 'center' }}>
              {displayValue('headers')
                ? <>{displayValue('headers')}{isActive('headers') && cursor}</>
                : <span style={{ color: '#444' }}>&nbsp;</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

**Step 3: Commit**

```bash
git add apps/web/src/pages/AIGateway.tsx
git commit -m "feat: add KiloCodeLogo and KiloMockPanel components"
```

---

### Task 4: Build the Tool Connection tab content

**Files:**
- Modify: `apps/web/src/pages/AIGateway.tsx` — replace `<p>Coming soon</p>` inside the tool-connection TabsContent

**Step 1: Replace the placeholder with full layout**

```tsx
<TabsContent value="tool-connection" style={{ marginTop: 0 }}>
  {/* Tool selector */}
  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '28px', flexWrap: 'wrap' }}>
    <span style={{ fontSize: '13px', fontWeight: 600, color: '#555' }}>Connect with:</span>

    {/* Kilo Code — active */}
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: '8px',
      padding: '8px 14px', borderRadius: '8px',
      border: '2px solid #e8d000', background: '#fefce8',
      fontWeight: 700, fontSize: '13px', color: '#1a1a2e',
    }}>
      <KiloCodeLogo />
      Kilo Code
    </div>

    {/* Coming soon tools */}
    {['OpenCode', 'Cursor', 'Continue'].map(name => (
      <span key={name} style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        padding: '8px 14px', borderRadius: '8px',
        border: '1px dashed #ccc', color: '#bbb',
        fontSize: '13px', fontWeight: 600,
      }}>
        {name}
        <span style={{ fontSize: '10px', background: '#f0f0f0', borderRadius: '4px', padding: '1px 5px', color: '#aaa' }}>
          soon
        </span>
      </span>
    ))}
  </div>

  {/* Two-column layout */}
  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: '32px', alignItems: 'start' }}>
    {/* Left: step list */}
    <div>
      <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '16px', margin: '0 0 16px' }}>
        Setup Instructions
      </h3>
      <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {KILO_STEPS.map((step, i) => {
          const isActiveStep = toolStep === i;
          const isDone = toolStep > i;
          return (
            <li key={i} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', opacity: isDone ? 0.4 : 1, transition: 'opacity 0.3s ease' }}>
              <span style={{
                flexShrink: 0, width: '22px', height: '22px', borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '11px', fontWeight: 700,
                background: isActiveStep ? '#1a1a2e' : isDone ? '#d1fae5' : '#f0f0f0',
                color: isActiveStep ? '#fff' : isDone ? '#16a34a' : '#888',
                transition: 'all 0.3s ease',
              }}>
                {isDone ? '✓' : i + 1}
              </span>
              <span style={{
                fontSize: '13px', lineHeight: 1.5,
                fontWeight: isActiveStep ? 600 : 400,
                color: isActiveStep ? '#111' : '#555',
                transition: 'all 0.3s ease',
                paddingTop: '3px',
              }}>
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>

    {/* Right: animated mock panel */}
    <KiloMockPanel toolStep={toolStep} typedText={typedText} proxyUrl={proxyUrl} />
  </div>
</TabsContent>
```

**Step 2: Commit**

```bash
git add apps/web/src/pages/AIGateway.tsx
git commit -m "feat: build tool connection tab layout with step list and mock panel"
```

---

### Task 5: Add cursor blink CSS

**Files:**
- Modify: `apps/web/src/styles/neobrutalist.css`

**Step 1: Append to end of file**

```css
/* Kilo Code mock panel — blinking cursor */
@keyframes kilo-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

.kilo-cursor {
  display: inline-block;
  animation: kilo-blink 0.8s ease-in-out infinite;
  color: #e8d000;
  margin-left: 1px;
  font-weight: 400;
}
```

**Step 2: Add responsive rule for small screens**

The two-column layout needs to collapse at narrow widths. Find the existing `@media (max-width: 768px)` block and add inside it:

```css
.kilo-two-col {
  grid-template-columns: 1fr !important;
}
```

Then add `className="kilo-two-col"` to the two-column grid div in Task 4 Step 1.

**Step 3: Verify visually**

Open AI Gateway page → "Tool Connection" tab and confirm:
- Kilo Code button has yellow border
- Step list cycles 0 → 1 → 2 → ... → 5 → 0 every ~2.8s
- Step numbers transition from active (dark) to done (green check) to upcoming (gray)
- Mock panel fields highlight in yellow and type in the correct value
- Blinking yellow cursor appears during typing

**Step 4: Commit**

```bash
git add apps/web/src/styles/neobrutalist.css
git commit -m "feat: add kilo cursor blink CSS and responsive grid rule"
```
