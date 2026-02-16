/**
 * Cloudflare Zero Trust DLP API client.
 * Lists available DLP profiles from the account for customers to attach to their gateways.
 */

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

export type CfDlpProfile = {
  id: string;
  name: string;
  description?: string;
  type: string;
  entries: Array<{
    id: string;
    name: string;
    enabled: boolean;
  }>;
  created_at?: string;
  updated_at?: string;
};

export async function listCfDlpProfiles(
  accountId: string,
  apiToken: string
): Promise<CfDlpProfile[]> {
  const res = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/dlp/profiles`,
    {
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`CF DLP profiles list failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { result: CfDlpProfile[] };
  return json.result;
}
