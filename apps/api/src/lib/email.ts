import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const from = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

export async function sendVerificationEmail(to: string, url: string): Promise<void> {
  if (!resend) {
    console.warn('RESEND_API_KEY not set; skipping verification email to', to);
    return;
  }
  const { error } = await resend.emails.send({
    from,
    to,
    subject: 'Verify your STEREOS email',
    html: `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;"><p>Click the link below to verify your email and activate your STEREOS account.</p><p><a href="${url}" style="display:inline-block;background:#1a1a1a;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;">Verify email</a></p><p>Or copy this link:</p><p style="word-break:break-all;color:#666;font-size:14px;">${url}</p><p style="color:#888;font-size:12px;margin-top:24px;">If you didn't sign up for STEREOS, you can ignore this email.</p></body></html>`,
  });
  if (error) {
    console.error('[Email] Failed to send verification email to', to, error);
    throw new Error(`Failed to send verification email: ${error.message}`);
  }
}

export async function sendMagicLinkEmail(to: string, url: string): Promise<void> {
  if (!resend) {
    console.warn('RESEND_API_KEY not set; magic link for', to, ':', url);
    return;
  }
  const { error } = await resend.emails.send({
    from,
    to,
    subject: 'Sign in to STEREOS',
    html: `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;"><p>Click the link below to sign in to your STEREOS account. This link expires in 10 minutes.</p><p><a href="${url}" style="display:inline-block;background:#1a1a1a;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;">Sign in to STEREOS</a></p><p>Or copy this link:</p><p style="word-break:break-all;color:#666;font-size:14px;">${url}</p><p style="color:#888;font-size:12px;margin-top:24px;">If you didn't request this link, you can safely ignore this email.</p></body></html>`,
  });
  if (error) {
    console.error('[Email] Failed to send magic link email to', to, error);
    throw new Error(`Failed to send magic link email: ${error.message}`);
  }
}

export async function sendInviteEmail(to: string, inviteUrl: string, inviterName: string, workspaceName: string): Promise<void> {
  if (!resend) {
    console.warn('RESEND_API_KEY not set; skipping invite email to', to);
    return;
  }
  const { error } = await resend.emails.send({
    from,
    to,
    subject: `You're invited to ${workspaceName} on STEREOS`,
    html: `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;"><p><strong>${inviterName}</strong> invited you to join <strong>${workspaceName}</strong> on STEREOS.</p><p><a href="${inviteUrl}" style="display:inline-block;background:#1a1a1a;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;">Accept invite</a></p><p style="word-break:break-all;color:#666;font-size:14px;">${inviteUrl}</p><p style="color:#888;font-size:12px;margin-top:24px;">This link expires in 7 days. If you didn't expect this invite, you can ignore this email.</p></body></html>`,
  });
  if (error) {
    console.error('[Email] Failed to send invite email to', to, error);
    throw new Error(`Failed to send invite email: ${error.message}`);
  }
}
