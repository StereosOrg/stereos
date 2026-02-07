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
exports.createRecordProvenanceTool = createRecordProvenanceTool;
const vscode = __importStar(require("vscode"));
const parseDiff_js_1 = require("./parseDiff.js");
function createRecordProvenanceTool(deps) {
    const { getStereos, getGitInfo, getRepoName, detectTool, getDiffHash, getDiffContent, actorId } = deps;
    return {
        async prepareInvocation(options, _token) {
            const { summary, files_changed } = options.input;
            const fileList = files_changed?.length ? files_changed.slice(0, 10).join(', ') + (files_changed.length > 10 ? '...' : '') : 'none listed';
            return {
                invocationMessage: 'Recording provenance with STEREOS',
                confirmationMessages: {
                    title: 'Record provenance',
                    message: new vscode.MarkdownString(`Record this change for provenance tracking?\n\n**Summary:** ${summary}\n\n**Files:** ${fileList}`),
                },
            };
        },
        async invoke(options, _token) {
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
            const diff_content = rawDiff ? JSON.stringify((0, parseDiff_js_1.parseUnifiedDiffToJson)(rawDiff)) : undefined;
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
function createTextResult(text) {
    // LanguageModelToolResult with a single text part
    // API: new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)])
    if (typeof vscode.LanguageModelToolResult !== 'undefined') {
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(text),
        ]);
    }
    return { result: text };
}
//# sourceMappingURL=recordProvenanceTool.js.map