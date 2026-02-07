export interface StereosConfig {
  apiToken: string;
  baseUrl?: string;
}

export interface TrackAgentActionPayload {
  actor_id: string;
  tool: string;
  model?: string;
  intent: string;
  files_written?: string[];
  repo: string;
  branch?: string;
  commit?: string;
  /** Optional hash of the diff or artifact identity (e.g. SHA-256 of repo+commit+files) for dedup/linking. */
  diff_hash?: string;
  /** Optional unified diff content (e.g. from `git diff`) for display in the dashboard. */
  diff_content?: string;
  metadata?: Record<string, unknown>;
}

export interface TrackResult {
  success: boolean;
  error?: string;
  event_id?: string;
}

export function createStereos(config: StereosConfig) {
  const baseUrl = (config.baseUrl || 'http://localhost:3000').replace(/\/$/, '');
  const apiToken = config.apiToken?.trim();

  return {
    async track(payload: TrackAgentActionPayload): Promise<TrackResult> {
      if (!apiToken) {
        return { success: false, error: 'API token is required' };
      }

      const body: Record<string, unknown> = {
        event_type: 'agent_action' as const,
        actor_type: 'agent' as const,
        actor_id: payload.actor_id,
        tool: payload.tool,
        intent: payload.intent,
        model: payload.model,
        files_written: payload.files_written ?? [],
        repo: payload.repo,
        branch: payload.branch,
        commit: payload.commit,
      };
      if (payload.diff_hash != null && payload.diff_hash !== '') {
        body.diff_hash = payload.diff_hash;
      }
      if (payload.diff_content != null && payload.diff_content !== '') {
        body.diff_content = payload.diff_content;
      }

      try {
        const res = await fetch(`${baseUrl}/v1/events`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiToken}`,
          },
          body: JSON.stringify(body),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          return {
            success: false,
            error: (data as { error?: string }).error || res.statusText || `HTTP ${res.status}`,
          };
        }

        return {
          success: true,
          event_id: (data as { event_id?: string }).event_id,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: message };
      }
    },
  };
}
