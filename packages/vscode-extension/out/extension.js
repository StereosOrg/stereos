"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const crypto = __importStar(require("crypto"));
const child_process_1 = require("child_process");
const simple_git_1 = require("simple-git");
const path = __importStar(require("path"));
const recordProvenanceTool_js_1 = require("./recordProvenanceTool.js");
const parseDiff_js_1 = require("./parseDiff.js");
/** Stable hash for artifact identity: repo + commit + sorted file list. Ensures ArtifactLink has a diff_hash. */
function computeDiffHash(repo, commit, files) {
    const normalized = [repo, commit ?? '', ...files.slice().sort()].join('\0');
    return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}
const SECRET_KEY = 'stereos.apiToken';
async function activate(context) {
    console.log('STEREOS extension is now active');
    const { createStereos } = await import('@stereos/sdk');
    const config = vscode.workspace.getConfiguration('stereos');
    let baseUrl = config.get('baseUrl') || 'http://localhost:3000';
    let dashboardUrl = (config.get('dashboardUrl') || 'http://localhost:5173').replace(/\/$/, '');
    // Token: prefer secretStorage (set by deep link or Configure), then config (manual settings.json).
    let tokenCache = undefined;
    let stereosInstance = null;
    async function resolveToken() {
        if (tokenCache !== undefined)
            return tokenCache ?? null;
        const fromSecret = (await context.secrets.get(SECRET_KEY))?.trim();
        const fromConfig = config.get('apiToken')?.trim();
        tokenCache = fromSecret || fromConfig || null;
        return tokenCache;
    }
    function getStereos() {
        const token = tokenCache ?? config.get('apiToken')?.trim();
        if (!token)
            return null;
        if (!stereosInstance)
            stereosInstance = createStereos({ apiToken: token, baseUrl });
        return stereosInstance;
    }
    const actorId = config.get('actorId') || 'vscode';
    const debounceMs = config.get('debounceMs') || 5000;
    const autoTrack = config.get('autoTrack') ?? true;
    // File watchers: created only once we have a token (from URI or after first resolveToken).
    let watcherInstalled = false;
    function ensureWatchers() {
        if (watcherInstalled || !vscode.workspace.workspaceFolders?.length)
            return;
        const token = tokenCache ?? config.get('apiToken')?.trim();
        if (!token || !autoTrack)
            return;
        watcherInstalled = true;
        const watcher = vscode.workspace.createFileSystemWatcher('**/*', false, false, false);
        watcher.onDidCreate(async (uri) => {
            const lineCount = await getLineCount(uri);
            pendingChanges.set(uri.toString(), { uri, timestamp: Date.now(), action: 'created', lineCount });
            scheduleFlush();
        });
        watcher.onDidChange(async (uri) => {
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
    context.subscriptions.push(vscode.window.registerUriHandler({
        handleUri(uri) {
            if (uri.path !== '/connect' && !uri.path.endsWith('/connect'))
                return;
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
                const base = params.get('baseUrl');
                const dash = params.get('dashboardUrl');
                if (base)
                    baseUrl = base.replace(/\/$/, '');
                if (dash)
                    dashboardUrl = dash.replace(/\/$/, '');
                ensureWatchers();
                vscode.window.showInformationMessage('STEREOS: Account connected. You can send events from this workspace.');
            })
                .catch(() => {
                vscode.window.showErrorMessage('STEREOS: Failed to store token.');
            });
        }
    }));
    // Git helper
    let git;
    let workspaceRoot;
    try {
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
            git = (0, simple_git_1.simpleGit)(workspaceRoot);
        }
    }
    catch (e) {
        console.log('Git not available');
    }
    // Pending changes tracker
    const pendingChanges = new Map();
    let flushTimeout = null;
    let sessionStartTime = Date.now();
    // Get comprehensive git info
    async function getGitInfo() {
        try {
            if (!git)
                return {};
            const branch = await git.revparse(['--abbrev-ref', 'HEAD']);
            const commit = await git.revparse(['HEAD']);
            const remote = await git.getRemotes(true);
            const repoUrl = remote.length > 0 ? remote[0].refs.fetch : undefined;
            return {
                branch: branch || 'main',
                commit: commit || 'HEAD',
                repoUrl
            };
        }
        catch {
            return { branch: 'main', commit: 'HEAD' };
        }
    }
    // Get repository name
    function getRepoName() {
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            return path.basename(vscode.workspace.workspaceFolders[0].uri.fsPath);
        }
        return 'unknown-repo';
    }
    /** Get unified diff: working tree vs HEAD, or if clean then last commit vs its parent. */
    async function getDiffContent(relativePaths) {
        const maxBuffer = 512 * 1024; // 512KB
        const truncate = (s) => (s.length > maxBuffer ? s.slice(0, maxBuffer) + '\n\n... (truncated)' : s);
        try {
            if (!workspaceRoot)
                return '';
            const pathArgs = relativePaths.length > 0 ? ['--', ...relativePaths] : [];
            // 1) Uncommitted changes: working tree vs HEAD
            const wt = (0, child_process_1.spawnSync)('git', ['diff', 'HEAD', ...pathArgs], { cwd: workspaceRoot, encoding: 'utf-8', maxBuffer });
            if (wt.status === 0 && wt.stdout && wt.stdout.trim().length > 0)
                return truncate(wt.stdout);
            // 2) No uncommitted changes: diff of last commit (HEAD vs HEAD~1) for these paths
            const last = (0, child_process_1.spawnSync)('git', ['diff', 'HEAD~1', 'HEAD', ...pathArgs], { cwd: workspaceRoot, encoding: 'utf-8', maxBuffer });
            if (last.status === 0 && last.stdout && last.stdout.trim().length > 0)
                return truncate(last.stdout);
            return '';
        }
        catch {
            return '';
        }
    }
    // Get file line count
    async function getLineCount(uri) {
        try {
            const document = await vscode.workspace.openTextDocument(uri);
            return document.lineCount;
        }
        catch {
            return 0;
        }
    }
    // Detect which AI tool is active
    function detectTool() {
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
    function detectCursorModel() {
        try {
            // Cursor typically shows model in status bar or settings
            const cursorConfig = vscode.workspace.getConfiguration('cursor');
            const model = cursorConfig.get('aiModel');
            return model || 'claude-3-sonnet';
        }
        catch {
            return 'claude-3-sonnet';
        }
    }
    // Track changes to STEREOS (requires API token)
    async function trackChanges(force = false) {
        const stereos = getStereos();
        if (!stereos)
            return;
        if (pendingChanges.size === 0)
            return;
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
        }
        else if (deletedCount > 0 && createdCount === 0 && modifiedCount === 0) {
            intent = `Deleted ${deletedCount} file(s)`;
        }
        else if (modifiedCount > 0 && createdCount === 0 && deletedCount === 0) {
            const extensions = [...new Set(files.map(f => path.extname(f.path)).filter(Boolean))];
            intent = `Modified ${modifiedCount} file(s)${extensions.length > 0 ? ` (${extensions.join(', ')})` : ''}`;
        }
        else {
            intent = `Changed ${files.length} file(s)`;
            if (createdCount > 0)
                intent += ` - ${createdCount} created`;
            if (modifiedCount > 0)
                intent += ` - ${modifiedCount} modified`;
            if (deletedCount > 0)
                intent += ` - ${deletedCount} deleted`;
        }
        // Calculate session duration
        const sessionDuration = Math.floor((Date.now() - sessionStartTime) / 1000);
        const rawDiff = await getDiffContent(filePaths);
        const diff_content = rawDiff ? JSON.stringify((0, parseDiff_js_1.parseUnifiedDiffToJson)(rawDiff)) : undefined;
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
                vscode.window.setStatusBarMessage(`$(check) STEREOS: Tracked ${files.length} change(s)`, 3000);
                pendingChanges.clear();
            }
            else {
                console.error('STEREOS tracking failed:', result.error);
            }
        }
        catch (error) {
            console.error('STEREOS error:', error);
        }
    }
    // Debounced flush (only runs when watchers are active, i.e. token was present at activation)
    function scheduleFlush() {
        if (!getStereos() || !autoTrack)
            return;
        if (flushTimeout) {
            clearTimeout(flushTimeout);
        }
        flushTimeout = setTimeout(() => trackChanges(), debounceMs);
    }
    // Resolve token at activation so watchers can be installed if token exists (secretStorage or config).
    resolveToken().then(() => ensureWatchers());
    // Commands
    // Track Change command with detailed input (requires API token)
    const trackChangeCmd = vscode.commands.registerCommand('stereos.trackChange', async () => {
        await resolveToken();
        if (!getStereos()) {
            vscode.window.showWarningMessage('STEREOS: Connect your account to send events.', 'Connect account').then(sel => { if (sel === 'Connect account')
                vscode.commands.executeCommand('stereos.connectAccount'); });
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
        if (!intent)
            return;
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
        if (!stereos)
            return;
        const rawDiff = await getDiffContent([filePath]);
        const diff_content = rawDiff ? JSON.stringify((0, parseDiff_js_1.parseUnifiedDiffToJson)(rawDiff)) : undefined;
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
            vscode.window.showInformationMessage(`✅ Tracked: ${intent}`);
        }
        else {
            vscode.window.showErrorMessage(`❌ Failed: ${result.error}`);
        }
    });
    // Connect account: open dashboard so user can use "Connect VS Code" and get token via deep link.
    const connectAccountCmd = vscode.commands.registerCommand('stereos.connectAccount', () => {
        const connectUrl = `${dashboardUrl}/settings?connect=vscode`;
        vscode.env.openExternal(vscode.Uri.parse(connectUrl));
        vscode.window.showInformationMessage('STEREOS: Open the dashboard and click "Connect VS Code" to link this workspace (no manual token needed).');
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
            ensureWatchers();
            vscode.window.showInformationMessage('STEREOS: Account connected. You can send events from this workspace.');
        }
    });
    // Toggle auto-track
    const toggleCmd = vscode.commands.registerCommand('stereos.toggleAutoTrack', async () => {
        const current = config.get('autoTrack') ?? true;
        await config.update('autoTrack', !current, true);
        vscode.window.showInformationMessage(`STEREOS: Auto-tracking ${!current ? 'enabled' : 'disabled'}`);
    });
    // View Provenance command (embedded dashboard)
    const viewCmd = vscode.commands.registerCommand('stereos.viewProvenance', () => {
        const panel = vscode.window.createWebviewPanel('stereosProvenance', 'STEREOS Provenance', vscode.ViewColumn.One, { enableScripts: true });
        panel.webview.html = getProvenanceHtml(dashboardUrl);
    });
    // Open Dashboard in browser (deep link to dashboard)
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
    // Force flush command (requires API token)
    const flushCmd = vscode.commands.registerCommand('stereos.flush', async () => {
        await resolveToken();
        if (!getStereos()) {
            vscode.window.showWarningMessage('STEREOS: Connect your account to send events.', 'Connect account').then(sel => { if (sel === 'Connect account')
                vscode.commands.executeCommand('stereos.connectAccount'); });
            return;
        }
        if (flushTimeout) {
            clearTimeout(flushTimeout);
        }
        await trackChanges(true);
        vscode.window.showInformationMessage('STEREOS: Changes flushed');
    });
    // Language Model Tool: agent (Copilot/Cursor) can call this after making edits for edit-level provenance
    const recordProvenanceTool = (0, recordProvenanceTool_js_1.createRecordProvenanceTool)({
        getStereos: () => getStereos(),
        getGitInfo,
        getRepoName,
        detectTool,
        getDiffHash: computeDiffHash,
        getDiffContent,
        actorId,
    });
    const lm = vscode.lm;
    if (lm?.registerTool) {
        try {
            context.subscriptions.push(lm.registerTool('stereos_recordProvenance', recordProvenanceTool));
            console.log('STEREOS: Language Model Tool "recordProvenance" registered (use #recordProvenance in chat)');
        }
        catch (e) {
            console.warn('STEREOS: Could not register Language Model Tool:', e);
        }
    }
    // Tree view for STEREOS sidebar (so the view has content and the activity bar is visible)
    class StereosTreeProvider {
        getTreeItem(element) {
            return element;
        }
        getChildren() {
            return [
                makeItem('Open Dashboard', 'stereos.openDashboard', 'link-external'),
                makeItem('Connect account', 'stereos.connectAccount', 'link-external'),
                makeItem('Track Code Change', 'stereos.trackChange', 'edit'),
            ];
        }
    }
    function makeItem(label, command, icon) {
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        item.command = { command, title: label };
        item.iconPath = new vscode.ThemeIcon(icon);
        return item;
    }
    const treeProvider = new StereosTreeProvider();
    context.subscriptions.push(vscode.window.registerTreeDataProvider('stereos.provenance', treeProvider));
    context.subscriptions.push(trackChangeCmd, connectAccountCmd, configureCmd, toggleCmd, viewCmd, openDashboardCmd, openEventCmd, flushCmd);
    // Set context so all commands show in palette (deep links work without token)
    vscode.commands.executeCommand('setContext', 'stereos.enabled', true);
    resolveToken().then(t => {
        console.log('STEREOS: Extension activated (use Connect account or Open Dashboard; token present =', !!t, ')');
        if (t)
            console.log(`STEREOS: Detected tool: ${detectTool().tool}`);
    });
}
function deactivate() {
    console.log('STEREOS extension is now deactivated');
}
function getProvenanceHtml(dashboardUrl) {
    const src = dashboardUrl.replace(/"/g, '&quot;');
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>STEREOS Provenance</title>
  <style>
    body { font-family: system-ui; padding: 0; margin: 0; }
    iframe { width: 100%; height: 100vh; border: none; }
  </style>
</head>
<body>
  <iframe src="${src}" />
</body>
</html>`;
}
//# sourceMappingURL=extension.js.map