/**
 * Standard ID and token generation for new records.
 * All app-created records use these helpers so format stays consistent (UUID-based).
 */

/** Primary key format: standard UUID (e.g. for User, Session, Account, Customer). */
export function newUuid(): string {
  return crypto.randomUUID();
}

/** Our session tokens: prefix "ba_" + no-dash UUID (distinguishable from better-auth’s). */
export function newSessionToken(): string {
  return `ba_${crypto.randomUUID().replace(/-/g, '')}`;
}

/** Customer external id: "cust_" + 16 hex chars from UUID. */
export function newCustomerId(): string {
  return `cust_${crypto.randomUUID().replace(/-/g, '').substring(0, 16)}`;
}

/** API token value: "sk_" + no-dash UUID. */
export function newApiToken(): string {
  return `sk_${crypto.randomUUID().replace(/-/g, '')}`;
}

/** Invite token: long opaque string (two no-dash UUIDs, second truncated). */
export function newInviteToken(): string {
  return (
    crypto.randomUUID().replace(/-/g, '') +
    crypto.randomUUID().replace(/-/g, '').slice(0, 8)
  );
}
