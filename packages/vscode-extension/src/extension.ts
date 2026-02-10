import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { spawnSync } from 'child_process';
import { simpleGit, SimpleGit } from 'simple-git';
import * as path from 'path';
import { createRecordProvenanceTool } from './recordProvenanceTool.js';
import { parseUnifiedDiffToJson } from './parseDiff.js';

/** Stable hash for artifact identity: repo + commit + sorted file list. Ensures ArtifactLink has a diff_hash. */
function computeDiffHash(repo: string, commit: string | undefined, files: string[]): string {
  const normalized = [repo, commit ?? '', ...files.slice().sort()].join('\0');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

interface PendingChange {
  uri: vscode.Uri;
  timestamp: number;
  action: 'created' | 'modified' | 'deleted';
  lineCount?: number;
}

const SECRET_KEY = 'stereos.apiToken';

/** Inline API client: POST /v1/events (no @stereos/sdk dependency so packaging doesn't pull in workspace). */
function createStereos(config: { apiToken: string; baseUrl: string }) {
  const baseUrl = config.baseUrl.replace(/\/$/, '');
  const apiToken = config.apiToken?.trim();
  return {
    async track(payload: {
      actor_id: string;
      tool: string;
      model?: string;
      intent: string;
      files_written?: string[];
      repo: string;
      branch?: string;
      commit?: string;
      diff_hash?: string;
      diff_content?: string;
      metadata?: Record<string, unknown>;
    }): Promise<{ success: boolean; error?: string; event_id?: string }> {
      if (!apiToken) return { success: false, error: 'API token is required' };
      const body = {
        event_type: 'agent_action' as const,
        actor_type: 'agent' as const,
        ...payload,
        files_written: payload.files_written ?? [],
      };
      try {
        const url = `${baseUrl}/v1/events`;
        console.log(`STEREOS: POST ${url} (intent: ${payload.intent?.slice(0, 50)}...)`);
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const errMsg = (data as { error?: string }).error || res.statusText || `HTTP ${res.status}`;
          console.error('STEREOS: Send failed', res.status, errMsg);
          return { success: false, error: errMsg };
        }
        console.log('STEREOS: Event sent', (data as { event_id?: string }).event_id);
        return { success: true, event_id: (data as { event_id?: string }).event_id };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error('STEREOS: Request error', errMsg);
        return { success: false, error: errMsg };
      }
    },
  };
}

export async function activate(context: vscode.ExtensionContext) {
  console.log('STEREOS extension is now active');

  const config = vscode.workspace.getConfiguration('stereos');
  const baseUrl = config.get<string>('baseUrl')?.trim() || 'https://api.trystereos.com';
  const dashboardUrl = config.get<string>('dashboardUrl')?.trim() || 'https://app.trystereos.com';

  // Token: prefer secretStorage (set by deep link or Configure), then config (manual settings.json).
  let tokenCache: string | null | undefined = undefined;
  let stereosInstance: ReturnType<typeof createStereos> | null = null;

  async function resolveToken(): Promise<string | null> {
    if (tokenCache !== undefined) return tokenCache ?? null;
    const fromSecret = (await context.secrets.get(SECRET_KEY))?.trim();
    const fromConfig = config.get<string>('apiToken')?.trim();
    tokenCache = fromSecret || fromConfig || null;
    return tokenCache;
  }

  function getBaseUrl(): string {
    return config.get<string>('baseUrl')?.trim() || 'https://api.trystereos.com';
  }

  function getStereos() {
    const token = tokenCache ?? config.get<string>('apiToken')?.trim();
    if (!token) return null;
    const url = getBaseUrl();
    if (!stereosInstance || (stereosInstance as { _baseUrl?: string })._baseUrl !== url) {
      stereosInstance = createStereos({ apiToken: token, baseUrl: url });
      (stereosInstance as { _baseUrl?: string })._baseUrl = url;
    }
    return stereosInstance;
  }

  const actorId = config.get<string>('actorId') || 'vscode';
  const debounceMs = config.get<number>('debounceMs') || 5000;
  function getAutoTrack(): boolean {
    return config.get<boolean>('autoTrack') ?? true;
  }

  // File watchers: created only once we have a token (from URI or after first resolveToken).
  let watcherInstalled = false;
  function ensureWatchers() {
    if (watcherInstalled || !vscode.workspace.workspaceFolders?.length) return;
    const token = tokenCache ?? config.get<string>('apiToken')?.trim();
    if (!token || !getAutoTrack()) return;
    watcherInstalled = true;
    const watcher = vscode.workspace.createFileSystemWatcher('**/*', false, false, false);
    watcher.onDidCreate(async uri => {
      const lineCount = await getLineCount(uri);
      pendingChanges.set(uri.toString(), { uri, timestamp: Date.now(), action: 'created', lineCount });
      scheduleFlush();
    });
    watcher.onDidChange(async uri => {
      const lineCount = await getLineCount(uri);
      pendingChanges.set(uri.toString(), { uri, timestamp: Date.now(), action: 'modified', lineCount });
      scheduleFlush();
    });
    watcher.onDidDelete(uri => {
      pendingChanges.set(uri.toString(), { uri, timestamp: Date.now(), action: 'deleted' });
      scheduleFlush();
    });
    context.subscriptions.push(watcher);
  }

  // URI handler: vscode://stereos.stereos-provenance/connect?token=...&baseUrl=...&dashboardUrl=...
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri(uri: vscode.Uri) {
        if (uri.path !== '/connect' && !uri.path.endsWith('/connect')) return;
        const params = new URLSearchParams(uri.query || '');
        const tokenParam = params.get('token');
        if (!tokenParam?.trim()) {
          vscode.window.showErrorMessage('STEREOS: Connect link had no token.');
          return;
        }
        const newToken = tokenParam.trim();
        void Promise.resolve(context.secrets.store(SECRET_KEY, newToken))
          .then(() => {
            tokenCache = newToken;
            stereosInstance = null;
            onConnected();
            vscode.window.showInformationMessage('Stereos: Account connected. You can send events from this workspace.');
          })
          .catch(() => {
            vscode.window.showErrorMessage('STEREOS: Failed to store token.');
          });
      }
    })
  );

  // Git helper
  let git: SimpleGit | undefined;
  let workspaceRoot: string | undefined;
  
  try {
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
      git = simpleGit(workspaceRoot);
    }
  } catch (e) {
    console.log('Git not available');
  }

  // Pending changes tracker
  const pendingChanges = new Map<string, PendingChange>();
  let flushTimeout: NodeJS.Timeout | null = null;
  let sessionStartTime = Date.now();
  let lastSendFailed = false;
  let refreshTree: () => void = () => {};

  // Status bar: single source of truth for connection + pending state
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  context.subscriptions.push(statusBarItem);

  function isConnected(): boolean {
    const token = tokenCache ?? config.get<string>('apiToken')?.trim();
    return !!token?.trim();
  }

  function updateStatusBar(): void {
    if (lastSendFailed) {
      statusBarItem.text = '$(warning) Stereos: Send failed';
      statusBarItem.tooltip = 'Last send failed. Click to open dashboard or connect.';
      statusBarItem.command = 'stereos.openDashboard';
      statusBarItem.show();
      return;
    }
    if (!isConnected()) {
      statusBarItem.text = '$(link) Stereos: Not connected';
      statusBarItem.tooltip = 'Connect your account to track AI-assisted changes';
      statusBarItem.command = 'stereos.connectAccount';
      statusBarItem.show();
      return;
    }
    const pending = pendingChanges.size;
    if (pending > 0) {
      statusBarItem.text = `$(sync~spin) Stereos: ${pending} pending`;
      statusBarItem.tooltip = `Sending changes in ${Math.ceil(debounceMs / 1000)}s`;
      statusBarItem.command = 'stereos.openDashboard';
    } else {
      statusBarItem.text = '$(check) Stereos: Connected';
      statusBarItem.tooltip = 'Track AI-assisted code changes';
      statusBarItem.command = 'stereos.openDashboard';
    }
    statusBarItem.show();
  }

  // Get comprehensive git info
  async function getGitInfo() {
    try {
      if (!git) return {};
      const branch = await git.revparse(['--abbrev-ref', 'HEAD']);
      const commit = await git.revparse(['HEAD']);
      const remote = await git.getRemotes(true);
      const repoUrl = remote.length > 0 ? remote[0].refs.fetch : undefined;
      
      return { 
        branch: branch || 'main', 
        commit: commit || 'HEAD',
        repoUrl 
      };
    } catch {
      return { branch: 'main', commit: 'HEAD' };
    }
  }

  // Get repository name
  function getRepoName(): string {
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      return path.basename(vscode.workspace.workspaceFolders[0].uri.fsPath);
    }
    return 'unknown-repo';
  }

  /** Get unified diff: working tree vs HEAD, or if clean then last commit vs its parent. */
  async function getDiffContent(relativePaths: string[]): Promise<string> {
    const maxBuffer = 512 * 1024; // 512KB
    const truncate = (s: string) => (s.length > maxBuffer ? s.slice(0, maxBuffer) + '\n\n... (truncated)' : s);
    try {
      if (!workspaceRoot) return '';
      const pathArgs = relativePaths.length > 0 ? ['--', ...relativePaths] : [];
      // 1) Uncommitted changes: working tree vs HEAD
      const wt = spawnSync('git', ['diff', 'HEAD', ...pathArgs], { cwd: workspaceRoot, encoding: 'utf-8', maxBuffer });
      if (wt.status === 0 && wt.stdout && wt.stdout.trim().length > 0) return truncate(wt.stdout);
      // 2) No uncommitted changes: diff of last commit (HEAD vs HEAD~1) for these paths
      const last = spawnSync('git', ['diff', 'HEAD~1', 'HEAD', ...pathArgs], { cwd: workspaceRoot, encoding: 'utf-8', maxBuffer });
      if (last.status === 0 && last.stdout && last.stdout.trim().length > 0) return truncate(last.stdout);
      return '';
    } catch {
      return '';
    }
  }

  // Get file line count
  async function getLineCount(uri: vscode.Uri): Promise<number> {
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      return document.lineCount;
    } catch {
      return 0;
    }
  }

  // Detect which AI tool is active
  function detectTool(): { tool: string; model?: string } {
    const appName = vscode.env.appName.toLowerCase();
    
    if (appName.includes('cursor')) {
      return { tool: 'cursor', model: detectCursorModel() };
    }
    
    if (vscode.extensions.getExtension('github.copilot')) {
      return { tool: 'github-copilot', model: 'gpt-4' };
    }

    if (vscode.extensions.getExtension('sourcegraph.cody-ai')) {
      return { tool: 'sourcegraph-cody', model: 'claude-3-sonnet' };
    }

    if (vscode.extensions.getExtension('Continue.continue')) {
      return { tool: 'continue', model: 'claude-3-sonnet' };
    }

    if (vscode.extensions.getExtension('supermaven.supermaven')) {
      return { tool: 'supermaven' };
    }

    if (vscode.extensions.getExtension('Codeium.codeium')) {
      return { tool: 'codeium' };
    }

    return { tool: 'vscode' };
  }

  // Detect Cursor model from settings or context
  function detectCursorModel(): string | undefined {
    try {
      // Cursor typically shows model in status bar or settings
      const cursorConfig = vscode.workspace.getConfiguration('cursor');
      const model = cursorConfig.get<string>('aiModel');
      return model || 'claude-3-sonnet';
    } catch {
      return 'claude-3-sonnet';
    }
  }

  // Track changes to STEREOS (requires API token)
  async function trackChanges(force: boolean = false) {
    const stereos = getStereos();
    if (!stereos) return;
    if (pendingChanges.size === 0) return;

    const changes = Array.from(pendingChanges.values());
    const files = changes.map(change => ({
      path: vscode.workspace.asRelativePath(change.uri),
      action: change.action,
      lineCount: change.lineCount || 0
    }));

    const filePaths = files.map(f => f.path);
    const { branch, commit, repoUrl } = await getGitInfo();
    const repo = getRepoName();
    const { tool, model } = detectTool();

    // Build intelligent intent
    const createdCount = files.filter(f => f.action === 'created').length;
    const modifiedCount = files.filter(f => f.action === 'modified').length;
    const deletedCount = files.filter(f => f.action === 'deleted').length;
    
    let intent = '';
    if (createdCount > 0 && modifiedCount === 0 && deletedCount === 0) {
      intent = `Created ${createdCount} file(s)`;
    } else if (deletedCount > 0 && createdCount === 0 && modifiedCount === 0) {
      intent = `Deleted ${deletedCount} file(s)`;
    } else if (modifiedCount > 0 && createdCount === 0 && deletedCount === 0) {
      const extensions = [...new Set(files.map(f => path.extname(f.path)).filter(Boolean))];
      intent = `Modified ${modifiedCount} file(s)${extensions.length > 0 ? ` (${extensions.join(', ')})` : ''}`;
    } else {
      intent = `Changed ${files.length} file(s)`;
      if (createdCount > 0) intent += ` - ${createdCount} created`;
      if (modifiedCount > 0) intent += ` - ${modifiedCount} modified`;
      if (deletedCount > 0) intent += ` - ${deletedCount} deleted`;
    }

    // Calculate session duration
    const sessionDuration = Math.floor((Date.now() - sessionStartTime) / 1000);

    const rawDiff = await getDiffContent(filePaths);
    const diff_content = rawDiff ? JSON.stringify(parseUnifiedDiffToJson(rawDiff)) : undefined;

    try {
      const result = await stereos.track({
        actor_id: actorId,
        tool,
        model,
        intent,
        files_written: filePaths,
        repo,
        branch,
        commit,
        diff_hash: computeDiffHash(repo, commit, filePaths),
        diff_content,
        metadata: {
          repo_url: repoUrl,
          file_count: files.length,
          created_count: createdCount,
          modified_count: modifiedCount,
          deleted_count: deletedCount,
          total_lines: files.reduce((sum, f) => sum + (f.lineCount || 0), 0),
          session_duration_seconds: sessionDuration,
          workspace: workspaceRoot,
          vscode_version: vscode.version,
          extension_version: '1.0.0',
        }
      });

      if (result.success) {
        lastSendFailed = false;
        pendingChanges.clear();
        updateStatusBar();
        vscode.window.setStatusBarMessage(
          `$(check) Stereos: Tracked ${files.length} change(s)`,
          3000
        );
      } else {
        lastSendFailed = true;
        console.error('STEREOS tracking failed:', result.error);
        updateStatusBar();
        vscode.window.showWarningMessage(
          `Stereos: Send failed. ${result.error ?? 'Unknown error'}`,
          'Open Dashboard',
          'Connect account'
        ).then(sel => {
          if (sel === 'Open Dashboard') vscode.commands.executeCommand('stereos.openDashboard');
          else if (sel === 'Connect account') vscode.commands.executeCommand('stereos.connectAccount');
        });
      }
    } catch (error) {
      lastSendFailed = true;
      console.error('STEREOS error:', error);
      updateStatusBar();
      vscode.window.showWarningMessage(
        `Stereos: Send failed. ${error instanceof Error ? error.message : 'Network or server error'}`,
        'Open Dashboard',
        'Connect account'
      ).then(sel => {
        if (sel === 'Open Dashboard') vscode.commands.executeCommand('stereos.openDashboard');
        else if (sel === 'Connect account') vscode.commands.executeCommand('stereos.connectAccount');
      });
    }
  }

  // Debounced flush (only runs when watchers are active, i.e. token was present at activation)
  function scheduleFlush() {
    if (!getStereos() || !getAutoTrack()) return;

    if (flushTimeout) {
      clearTimeout(flushTimeout);
    }
    flushTimeout = setTimeout(() => trackChanges(), debounceMs);
    updateStatusBar();
  }

  /** Run flush now (e.g. from Flush Pending Changes command). */
  function flushNow() {
    if (flushTimeout) {
      clearTimeout(flushTimeout);
      flushTimeout = null;
    }
    if (!getStereos()) {
      vscode.window.showWarningMessage('STEREOS: Connect your account first.');
      return;
    }
    if (pendingChanges.size === 0) {
      vscode.window.showInformationMessage('STEREOS: No pending file changes to send. Edit and save a file to track.');
      return;
    }
    console.log(`STEREOS: Flush now (${pendingChanges.size} pending)`);
    void trackChanges();
  }

  // Called when token is set (URI handler or Configure) so UI updates
  function onConnected(): void {
    lastSendFailed = false;
    ensureWatchers();
    updateStatusBar();
    refreshTree();
  }

  // Resolve token at activation so watchers are installed if token exists (secretStorage or config).
  resolveToken().then(() => {
    ensureWatchers();
    updateStatusBar();
    refreshTree();
    if (vscode.workspace.workspaceFolders?.length === 0 && (tokenCache ?? config.get<string>('apiToken')?.trim())) {
      console.warn('STEREOS: No workspace folder open — file watchers not active. Open a folder to auto-track changes.');
    }
  });

  // Commands

  // Track Change command with detailed input (requires API token)
  const trackChangeCmd = vscode.commands.registerCommand('stereos.trackChange', async () => {
    await resolveToken();
    if (!getStereos()) {
      vscode.window.showWarningMessage(
        'STEREOS: Connect your account to send events.',
        'Connect account'
      ).then(sel => { if (sel === 'Connect account') vscode.commands.executeCommand('stereos.connectAccount'); });
      return;
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('No active editor');
      return;
    }

    const filePath = vscode.workspace.asRelativePath(editor.document.uri);
    const lineCount = editor.document.lineCount;
    const selection = editor.selection;
    const selectedText = editor.document.getText(selection);

    // Multi-step input for rich context
    const intent = await vscode.window.showInputBox({
      prompt: 'What are you doing?',
      placeHolder: 'e.g., "Refactor authentication module"',
      value: selectedText ? `Modified ${filePath} (${lineCount} lines)` : `Working on ${filePath}`
    });

    if (!intent) return;

    // Optional: Ask for AI model if not auto-detected
    const { tool, model: detectedModel } = detectTool();
    let model = detectedModel;
    
    if (!model) {
      const modelInput = await vscode.window.showQuickPick([
        'claude-3-opus',
        'claude-3-sonnet',
        'claude-3-haiku',
        'gpt-4',
        'gpt-4-turbo',
        'gpt-3.5-turbo',
        'Other'
      ], {
        placeHolder: 'Which AI model assisted with this change?'
      });
      if (modelInput && modelInput !== 'Other') {
        model = modelInput;
      }
    }

    const { branch, commit } = await getGitInfo();
    const repo = getRepoName();
    const stereos = getStereos();
    if (!stereos) return;

    const rawDiff = await getDiffContent([filePath]);
    const diff_content = rawDiff ? JSON.stringify(parseUnifiedDiffToJson(rawDiff)) : undefined;

    const result = await stereos.track({
      actor_id: actorId,
      tool,
      model,
      intent,
      files_written: [filePath],
      repo,
      branch,
      commit,
      diff_hash: computeDiffHash(repo, commit, [filePath]),
      diff_content,
      metadata: {
        line_count: lineCount,
        selected_text_length: selectedText.length,
        has_selection: !selection.isEmpty
      }
    });

    if (result.success) {
      lastSendFailed = false;
      updateStatusBar();
      vscode.window.showInformationMessage(`✅ Tracked: ${intent}`);
    } else {
      lastSendFailed = true;
      updateStatusBar();
      vscode.window.showErrorMessage(`❌ Failed: ${result.error}`);
    }
  });

  // Connect account: open dashboard in browser; user signs in there and clicks "Connect VS Code" — token is delivered via deep link only (no iframe/auth in extension).
  const connectAccountCmd = vscode.commands.registerCommand('stereos.connectAccount', () => {
    const connectUrl = `${dashboardUrl}/settings?connect=vscode`;
    vscode.env.openExternal(vscode.Uri.parse(connectUrl));
    vscode.window.showInformationMessage(
      'Stereos: Sign in in your browser, then click "Connect VS Code" to link this workspace. The extension will receive your token via the link.'
    );
  });

  // Configure command (manual token paste; also stored in secretStorage)
  const configureCmd = vscode.commands.registerCommand('stereos.configure', async () => {
    const token = await vscode.window.showInputBox({
      prompt: 'Paste your STEREOS API token (or use "Connect account" to get it from the dashboard)',
      password: true,
      ignoreFocusOut: true
    });

    if (token?.trim()) {
      await context.secrets.store(SECRET_KEY, token.trim());
      tokenCache = token.trim();
      stereosInstance = null;
      await config.update('apiToken', token.trim(), true);
      onConnected();
      vscode.window.showInformationMessage('Stereos: Account connected. You can send events from this workspace.');
    }
  });

  // Toggle auto-track — update the scope that is actually defining the value so the effective config changes
  const toggleCmd = vscode.commands.registerCommand('stereos.toggleAutoTrack', async () => {
    const current = config.get<boolean>('autoTrack') ?? true;
    const inspected = config.inspect<boolean>('autoTrack');
    const target =
      inspected?.workspaceFolderValue !== undefined
        ? vscode.ConfigurationTarget.WorkspaceFolder
        : inspected?.workspaceValue !== undefined
          ? vscode.ConfigurationTarget.Workspace
          : vscode.ConfigurationTarget.Global;
    await config.update('autoTrack', !current, target);
    if (!current) {
      ensureWatchers();
    }
    refreshTree();
    vscode.window.showInformationMessage(
      `Stereos: Auto-tracking ${!current ? 'enabled' : 'disabled'}`
    );
  });

  // Flush pending changes immediately
  const flushCmd = vscode.commands.registerCommand('stereos.flushPending', flushNow);

  // Open Dashboard in browser
  const openDashboardCmd = vscode.commands.registerCommand('stereos.openDashboard', () => {
    vscode.env.openExternal(vscode.Uri.parse(dashboardUrl));
  });

  // Open a specific event in dashboard (deep link)
  const openEventCmd = vscode.commands.registerCommand('stereos.openEvent', async () => {
    const eventId = await vscode.window.showInputBox({
      prompt: 'Paste event ID to open in dashboard',
      placeHolder: 'e.g. uuid from last tracked event',
    });
    if (eventId?.trim()) {
      const url = `${dashboardUrl}/events/${encodeURIComponent(eventId.trim())}`;
      vscode.env.openExternal(vscode.Uri.parse(url));
    }
  });

  // Language Model Tool: agent (Copilot/Cursor) can call this after making edits for edit-level provenance
  const recordProvenanceTool = createRecordProvenanceTool({
    getStereos: () => getStereos(),
    getGitInfo,
    getRepoName,
    detectTool,
    getDiffHash: computeDiffHash,
    getDiffContent,
    actorId,
  });
  const lm = (vscode as { lm?: { registerTool: (name: string, tool: unknown) => vscode.Disposable } }).lm;
  if (lm?.registerTool) {
    try {
      context.subscriptions.push(lm.registerTool('stereos_recordProvenance', recordProvenanceTool));
      console.log('STEREOS: Language Model Tool "recordProvenance" registered (use #recordProvenance in chat)');
    } catch (e) {
      console.warn('STEREOS: Could not register Language Model Tool:', e);
    }
  }

  // Tree view: auth state when not connected; main actions when connected (no separate Connect link)
  const treeChangeEmitter = new vscode.EventEmitter<void>();
  refreshTree = () => treeChangeEmitter.fire();

  function makeItem(label: string, command: string, icon: string, tooltip?: string): vscode.TreeItem {
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.command = { command, title: label };
    item.iconPath = new vscode.ThemeIcon(icon);
    if (tooltip) item.tooltip = tooltip;
    return item;
  }

  class StereosTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    onDidChangeTreeData = treeChangeEmitter.event;
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
      return element;
    }
    getChildren(): vscode.TreeItem[] {
      if (!isConnected()) {
        return [
          makeItem('Connect to Stereos', 'stereos.connectAccount', 'link', 'Open the web app to sign in or sign up, then click Connect VS Code to link this workspace'),
        ];
      }
      const autoTrackOn = config.get<boolean>('autoTrack') ?? true;
      return [
        makeItem('Open Dashboard', 'stereos.openDashboard', 'link-external'),
        makeItem('Track Code Change', 'stereos.trackChange', 'edit'),
        makeItem(autoTrackOn ? 'Toggle auto-tracking (on)' : 'Toggle auto-tracking (off)', 'stereos.toggleAutoTrack', autoTrackOn ? 'check' : 'circle-outline'),
        makeItem('Open settings', 'stereos.openSettings', 'gear'),
      ];
    }
  }
  const treeProvider = new StereosTreeProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('stereos.provenance', treeProvider)
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('stereos.autoTrack')) refreshTree();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('stereos.openSettings', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', 'stereos');
    })
  );

  context.subscriptions.push(
    trackChangeCmd,
    connectAccountCmd,
    configureCmd,
    toggleCmd,
    flushCmd,
    openDashboardCmd,
    openEventCmd
  );

  // Set context so all commands show in palette (deep links work without token)
  vscode.commands.executeCommand('setContext', 'stereos.enabled', true);

  resolveToken().then(t => {
    console.log('STEREOS: Extension activated (use Connect account or Open Dashboard; token present =', !!t, ')');
    if (t) console.log(`STEREOS: Detected tool: ${detectTool().tool}`);
  });
}

export function deactivate() {
  console.log('STEREOS extension is now deactivated');
}
