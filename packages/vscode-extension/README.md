# STEREOS VS Code Extension

Track AI-generated code changes directly from VS Code/Cursor.

## Features

✅ **Language Model Tool** - When the agent (Copilot/Cursor) calls `#recordProvenance` after making edits, STEREOS records provenance with edit-level attribution  
✅ **Automatic Tracking** - Tracks file saves, creates, and deletes (optional)  
✅ **AI Tool Detection** - Auto-detects Cursor, Copilot, Cody, Continue, Supermaven, Codeium  
✅ **Rich Context** - Captures git branch, commit, file line counts, session duration  
✅ **Manual Tracking** - Right-click to add detailed context  
✅ **Status Bar** - Visual confirmation when events are tracked  

## Installation

1. Build the SDK first (from repo root or packages/sdk), then the extension:
```bash
cd packages/sdk && npm run build
cd ../vscode-extension
npm install
npm run compile
```

2. Press F5 to run in debug mode, or package it:
```bash
npm install -g @vscode/vsce
vsce package
# Then install the .vsix file in VS Code
```

## Configuration

Set your STEREOS API token:
- Run command: `STEREOS: Configure API Token`
- **Recommended:** Use **Connect account** (sidebar or command palette) to open the dashboard; sign in, then click **Connect VS Code**. The extension receives the token via a secure link—no copy-paste.
- Or set in settings: `stereos.apiToken`, or use **Configure API Token** to paste a token (stored in VS Code secret storage).

Other settings:
- `stereos.baseUrl` - API base URL (default: http://localhost:3000)
- `stereos.dashboardUrl` - Dashboard URL for View Provenance and deep links (default: http://localhost:5173)
- `stereos.autoTrack` - Enable auto-tracking (default: true)
- `stereos.debounceMs` - Debounce time in ms (default: 5000)
- `stereos.actorId` - Actor identifier (default: vscode)

## Data Captured

The extension captures comprehensive event data:

```typescript
{
  actor_id: "vscode",           // Your configured actor ID
  tool: "cursor",               // Detected AI tool
  model: "claude-3-sonnet",     // AI model (if detected)
  intent: "Modified 3 files",   // Auto-generated or manual
  files_written: ["src/auth.ts", "src/middleware.ts"],
  repo: "my-project",
  branch: "feature/auth",
  commit: "abc123...",
  metadata: {
    repo_url: "https://github.com/user/repo",
    file_count: 3,
    created_count: 1,
    modified_count: 2,
    deleted_count: 0,
    total_lines: 450,
    session_duration_seconds: 3600,
    vscode_version: "1.85.0",
    workspace: "/path/to/project"
  }
}
```

## Commands

- `STEREOS: Track Code Change` - Manually track with detailed context
- `STEREOS: View Provenance` - Open dashboard in embedded webview
- `STEREOS: Open Dashboard` - Open dashboard in browser (deep link)
- `STEREOS: Open Event in Dashboard` - Open a specific event by ID in the dashboard
- `STEREOS: Flush Pending Changes` - Immediately send pending changes
- `STEREOS: Toggle Auto-Tracking` - Enable/disable auto-tracking
- `STEREOS: Configure API Token` - Set your API token

## Supported AI Tools

- ✅ Cursor (with model detection)
- ✅ GitHub Copilot
- ✅ Sourcegraph Cody
- ✅ Continue.dev
- ✅ Supermaven
- ✅ Codeium
- ✅ VS Code (generic)

## How It Works

1. **Language Model Tool** (recommended): In agent chat, the model can call `#recordProvenance` with a summary and list of files changed. STEREOS sends a provenance event so you get accurate edit-level attribution. Requires VS Code 1.85+ with Copilot agent mode (or Cursor with compatible tool support).
2. **File Watchers** (optional): Listen for create/modify/delete events, debounce (default: 5 seconds), then send a batch event. Tool is inferred from the editor (Cursor, Copilot, etc.).
3. **Git Integration** captures branch, commit, and repo info for all events.
4. **Manual** "Track Code Change" for one-off recording with full context.

## No Webhooks Needed!

Unlike other solutions, this extension captures events directly in the editor - no webhooks required from AI platforms.
