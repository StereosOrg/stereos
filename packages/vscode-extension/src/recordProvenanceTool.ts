import * as vscode from 'vscode';
import { parseUnifiedDiffToJson } from './parseDiff.js';

export interface RecordProvenanceInput {
  files_changed?: string[];
  summary: string;
  model?: string;
}

/**
 * Language Model Tool: when the agent (Copilot/Cursor) calls this after making edits,
 * we send a provenance event so we get edit-level attribution.
 * See https://code.visualstudio.com/api/extension-guides/ai/tools
 */
interface StereosTrackPayload {
  actor_id: string;
  tool: string;
  model?: string;
  intent: string;
  files_written: string[];
  repo: string;
  branch?: string;
  commit?: string;
  diff_hash?: string;
  diff_content?: string;
  metadata?: Record<string, unknown>;
}

export function createRecordProvenanceTool(deps: {
  getStereos: () => { track: (payload: StereosTrackPayload) => Promise<{ success: boolean; error?: string }> } | null;
  getGitInfo: () => Promise<{ branch?: string; commit?: string }>;
  getRepoName: () => string;
  detectTool: () => { tool: string; model?: string };
  getDiffHash: (repo: string, commit: string | undefined, files: string[]) => string;
  getDiffContent: (relativePaths: string[]) => Promise<string>;
  actorId: string;
}) {
  const { getStereos, getGitInfo, getRepoName, detectTool, getDiffHash, getDiffContent, actorId } = deps;

  return {
    async prepareInvocation(
      options: { input: RecordProvenanceInput },
      _token: vscode.CancellationToken
    ): Promise<{ invocationMessage: string; confirmationMessages: { title: string; message: vscode.MarkdownString } } | undefined> {
      const { summary, files_changed } = options.input;
      const fileList = files_changed?.length ? files_changed.slice(0, 10).join(', ') + (files_changed.length > 10 ? '...' : '') : 'none listed';
      return {
        invocationMessage: 'Recording provenance with STEREOS',
        confirmationMessages: {
          title: 'Record provenance',
          message: new vscode.MarkdownString(
            `Record this change for provenance tracking?\n\n**Summary:** ${summary}\n\n**Files:** ${fileList}`
          ),
        },
      };
    },

    async invoke(
      options: { input: RecordProvenanceInput },
      _token: vscode.CancellationToken
    ): Promise<unknown> {
      const stereos = getStereos();
      if (!stereos) {
        return createTextResult('Provenance not recorded: STEREOS API token is not configured. User can set it via STEREOS: Configure API Token.');
      }

      const { summary, files_changed, model: inputModel } = options.input;
      const { branch, commit } = await getGitInfo();
      const repo = getRepoName();
      const { tool, model: detectedModel } = detectTool();
      const model = inputModel || detectedModel;
      const files_written = Array.isArray(files_changed) && files_changed.length > 0
        ? files_changed
        : [];

      const rawDiff = await getDiffContent(files_written);
      const diff_content = rawDiff ? JSON.stringify(parseUnifiedDiffToJson(rawDiff)) : undefined;

      const result = await stereos.track({
        actor_id: actorId,
        tool,
        model,
        intent: summary,
        files_written,
        repo,
        branch,
        commit,
        diff_hash: getDiffHash(repo, commit, files_written),
        diff_content,
        metadata: { source: 'languageModelTool', files_count: files_written.length },
      });

      if (result.success) {
        return createTextResult(`Provenance recorded successfully. ${files_written.length} file(s) tracked.`);
      }
      return createTextResult(`Provenance recording failed: ${result.error ?? 'Unknown error'}.`);
    },
  };
}

function createTextResult(text: string): unknown {
  // LanguageModelToolResult with a single text part
  // API: new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)])
  if (typeof (vscode as any).LanguageModelToolResult !== 'undefined') {
    return new (vscode as any).LanguageModelToolResult([
      new (vscode as any).LanguageModelTextPart(text),
    ]);
  }
  return { result: text };
}
