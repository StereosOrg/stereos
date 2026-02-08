/**
 * Resend API via fetch — Worker-safe (no Resend SDK).
 * POST https://api.resend.com/emails
 */

const RESEND_API = 'https://api.resend.com/emails';

export interface ResendSendParams {
  apiKey: string;
  from: string;
  to: string | string[];
  subject: string;
  html: string;
}

export async function sendEmailViaResendFetch(params: ResendSendParams): Promise<{ id?: string; error?: string }> {
  const { apiKey, from, to, subject, html } = params;
  const res = await fetch(RESEND_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html }),
  });
  const data = (await res.json()) as { id?: string; message?: string; name?: string };
  if (!res.ok) {
    const msg = data?.message ?? data?.name ?? res.statusText;
    return { error: msg };
  }
  return { id: data.id };
}

export const VERIFICATION_EMAIL_HTML = (url: string) =>
  `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;"><p>Click the link below to verify your email and activate your STEREOS account.</p><p><a href="${url}" style="display:inline-block;background:#1a1a1a;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;">Verify email</a></p><p>Or copy this link:</p><p style="word-break:break-all;color:#666;font-size:14px;">${url}</p><p style="color:#888;font-size:12px;margin-top:24px;">If you didn't sign up for STEREOS, you can ignore this email.</p></body></html>`;
