/**
 * Cloudflare AI Gateway Logpush payload types and parsing utilities.
 */

export type LogpushDlpResult = {
  ProfileId?: string;
  ProfileName?: string;
  MatchedEntries?: string[];
  Action?: string;
};

export type LogpushAiGatewayEntry = {
  GatewayId?: string;
  RequestId?: string;
  Timestamp?: string;
  Model?: string;
  Provider?: string;
  Prompt?: string;
  Response?: string;
  Topic?: string;
  Summary?: string;
  DlpResults?: LogpushDlpResult[];
  [key: string]: unknown;
};

/**
 * Parse an NDJSON body (one JSON object per line) into an array of entries.
 * Tolerates blank lines and individual parse failures.
 */
export function parseLogpushNdjson(body: string): LogpushAiGatewayEntry[] {
  const entries: LogpushAiGatewayEntry[] = [];
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as LogpushAiGatewayEntry);
    } catch {
      // Skip malformed lines
    }
  }
  return entries;
}

/**
 * Placeholder for HPKE decryption of logpush payloads.
 * MVP: passthrough — HTTPS transport security is sufficient initially.
 * When CF's exact HPKE scheme is confirmed, implement decryption here.
 */
export function decryptLogpushPayload(body: string, _privateKey?: string): string {
  return body;
}
