import { pgTable, text, timestamp, boolean, uuid, jsonb, integer, decimal, doublePrecision, pgEnum, index, uniqueIndex, primaryKey } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ── Better Auth core tables ──────────────────────────────────────────────

export const userRoleEnum = pgEnum('user_role', ['admin', 'user']);

export const userTitleEnum = pgEnum('user_title', [
  'engineer',
  'manager',
  'cto',
  'founder',
  'vp',
  'lead',
  'architect',
  'product_manager'
]);

export const users = pgTable('User', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name'),
  firstName: text('first_name'),
  lastName: text('last_name'),
  email: text('email').unique().notNull(),
  emailVerified: boolean('emailVerified').default(false),
  image: text('image'),
  title: userTitleEnum('title').default('engineer'),
  role: userRoleEnum('role').default('user').notNull(),
  customer_id: text('customer_id'),
  onboarding_completed: boolean('onboarding_completed').default(false).notNull(),
  onboarding_completed_at: timestamp('onboarding_completed_at', { withTimezone: true }),
  createdAt: timestamp('createdAt', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).$onUpdate(() => new Date()),
});

export const accounts = pgTable('Account', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accountId: text('accountId').notNull(), // Better Auth: SSO account id or userId for credential; unique per provider
  type: text('type').notNull().default('credential'),
  provider: text('provider').notNull().default('credential'), // auth config maps providerId -> provider
  refresh_token: text('refresh_token'),
  access_token: text('access_token'),
  expires_at: integer('expires_at'),
  token_type: text('token_type'),
  scope: text('scope'),
  id_token: text('id_token'),
  session_state: text('session_state'),
  password: text('password'), // Better Auth: hashed password for email/password accounts
  createdAt: timestamp('createdAt', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).$onUpdate(() => new Date()),
}, (t) => ({
  uniqueProviderAccount: uniqueIndex('Account_provider_accountId').on(t.provider, t.accountId),
}));

export const sessions = pgTable('Session', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionToken: text('sessionToken').unique().notNull(),
  userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { withTimezone: true }).notNull(),
  createdAt: timestamp('createdAt', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).$onUpdate(() => new Date()),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
});

export const verifications = pgTable('Verification', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expiresAt', { withTimezone: true }).notNull(),
  createdAt: timestamp('createdAt', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).$onUpdate(() => new Date()),
});

// ── Custom tables ────────────────────────────────────────────────────────

export const partners = pgTable('Partner', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  partner_id: text('partner_id').unique().notNull(),
  secret_key: text('secret_key').unique().notNull(),
  stripe_account_id: text('stripe_account_id'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).$onUpdate(() => new Date()),
});

export const customers = pgTable('Customer', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').unique().notNull().references(() => users.id, { onDelete: 'cascade' }),
  partner_id: text('partner_id').notNull().references(() => partners.id),
  customer_id: text('customer_id').unique().notNull(),
  customer_stripe_id: text('customer_stripe_id').unique().notNull(),
  company_name: text('company_name'),
  billing_email: text('billing_email'),
  logo_url: text('logo_url'),
  payment_info_provided: boolean('payment_info_provided').default(false),
  payment_link_id: text('payment_link_id'),
  stripe_subscription_id: text('stripe_subscription_id'),
  onboarding_completed: boolean('onboarding_completed').default(false),
  onboarding_completed_at: timestamp('onboarding_completed_at', { withTimezone: true }),
  billing_status: text('billing_status').default('trial').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).$onUpdate(() => new Date()),
});

export const apiTokens = pgTable('ApiToken', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  customer_id: text('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  user_id: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  token: text('token').unique().notNull(),
  name: text('name').notNull(),
  scopes: text('scopes').array().notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  expires_at: timestamp('expires_at', { withTimezone: true }),
  last_used: timestamp('last_used', { withTimezone: true }),
}, (t) => ({
  customerIdx: index('ApiToken_customer_id_idx').on(t.customer_id),
  userIdx: index('ApiToken_user_id_idx').on(t.user_id),
}));

export const usageEvents = pgTable('UsageEvent', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  customer_id: text('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  partner_id: text('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  event_type: text('event_type').notNull(),
  idempotency_key: text('idempotency_key').notNull(),
  quantity: integer('quantity').default(1).notNull(),
  unit_price: decimal('unit_price', { precision: 10, scale: 4 }).default('0').notNull(),
  total_price: decimal('total_price', { precision: 10, scale: 4 }).default('0').notNull(),
  metadata: jsonb('metadata'),
  timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  customerIdx: index('UsageEvent_customer_id_idx').on(t.customer_id),
  partnerIdx: index('UsageEvent_partner_id_idx').on(t.partner_id),
  timeIdx: index('UsageEvent_created_at_idx').on(t.timestamp),
  idempotencyIdx: uniqueIndex('UsageEvent_idempotency_idx').on(t.customer_id, t.idempotency_key),
}));

// ── Provenance tables ────────────────────────────────────────────────────

export const provenanceEvents = pgTable('ProvenanceEvent', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  customer_id: text('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  partner_id: text('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  user_id: text('user_id').references(() => users.id, { onDelete: 'cascade' }), // Individual user who triggered the event
  title: text('title'), // User's title at time of event
  actor_type: text('actor_type').notNull(), // 'agent'
  actor_id: text('actor_id').notNull(), // e.g., 'cursor-v1', 'kilo-ci-bot'
  tool: text('tool').notNull(),
  model: text('model'),
  intent: text('intent').notNull(),
  files_written: text('files_written').array(),
  timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow().notNull(),
  event_hash: text('event_hash'), // Optional signing hash
}, (t) => ({
  customerIdx: index('ProvenanceEvent_customer_id_idx').on(t.customer_id),
  partnerIdx: index('ProvenanceEvent_partner_id_idx').on(t.partner_id),
  userIdx: index('ProvenanceEvent_user_id_idx').on(t.user_id),
  titleIdx: index('ProvenanceEvent_title_idx').on(t.title),
  timeIdx: index('ProvenanceEvent_timestamp_idx').on(t.timestamp),
  actorIdx: index('ProvenanceEvent_actor_idx').on(t.actor_id),
}));

export const artifactLinks = pgTable('ArtifactLink', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  event_id: text('event_id').notNull().references(() => provenanceEvents.id, { onDelete: 'cascade' }),
  repo: text('repo').notNull(),
  branch: text('branch'),
  commit: text('commit'),
  diff_hash: text('diff_hash'),
  diff_content: text('diff_content'),
}, (t) => ({
  eventIdx: index('ArtifactLink_event_id_idx').on(t.event_id),
  commitIdx: index('ArtifactLink_commit_idx').on(t.commit),
  repoIdx: index('ArtifactLink_repo_idx').on(t.repo),
}));

export const outcomes = pgTable('Outcome', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  event_id: text('event_id').notNull().references(() => provenanceEvents.id, { onDelete: 'cascade' }),
  status: text('status').notNull(), // 'accepted' | 'rejected' | 'superseded'
  linked_commit: text('linked_commit'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  eventIdx: index('Outcome_event_id_idx').on(t.event_id),
  statusIdx: index('Outcome_status_idx').on(t.status),
}));

export const invites = pgTable('Invite', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  customer_id: text('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  token: text('token').notNull().unique(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  invited_by_user_id: text('invited_by_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  used_at: timestamp('used_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  tokenIdx: index('Invite_token_idx').on(t.token),
  customerIdx: index('Invite_customer_id_idx').on(t.customer_id),
  emailIdx: index('Invite_email_idx').on(t.email),
}));

// ── Telemetry tables ─────────────────────────────────────────────────────

export const toolProfiles = pgTable('ToolProfile', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  customer_id: text('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  partner_id: text('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  vendor: text('vendor').notNull(),
  display_name: text('display_name').notNull(),
  logo_url: text('logo_url'),
  vendor_category: text('vendor_category'),
  total_spans: integer('total_spans').default(0).notNull(),
  total_traces: integer('total_traces').default(0).notNull(),
  total_errors: integer('total_errors').default(0).notNull(),
  first_seen_at: timestamp('first_seen_at', { withTimezone: true }),
  last_seen_at: timestamp('last_seen_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).$onUpdate(() => new Date()),
}, (t) => ({
  customerVendorIdx: uniqueIndex('ToolProfile_customer_vendor_idx').on(t.customer_id, t.vendor),
}));

export const telemetrySpans = pgTable('TelemetrySpan', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  customer_id: text('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  partner_id: text('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  user_id: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  tool_profile_id: text('tool_profile_id').references(() => toolProfiles.id, { onDelete: 'set null' }),
  trace_id: text('trace_id').notNull(),
  span_id: text('span_id').notNull(),
  parent_span_id: text('parent_span_id'),
  span_name: text('span_name').notNull(),
  span_kind: text('span_kind'),
  start_time: timestamp('start_time', { withTimezone: true }).notNull(),
  end_time: timestamp('end_time', { withTimezone: true }),
  duration_ms: integer('duration_ms'),
  status_code: text('status_code'),
  status_message: text('status_message'),
  vendor: text('vendor').notNull(),
  service_name: text('service_name'),
  resource_attributes: jsonb('resource_attributes'),
  span_attributes: jsonb('span_attributes'),
  signal_type: text('signal_type').default('trace'),
  ingested_at: timestamp('ingested_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  customerVendorTimeIdx: index('TelemetrySpan_customer_vendor_time_idx').on(t.customer_id, t.vendor, t.start_time),
  traceIdx: index('TelemetrySpan_trace_id_idx').on(t.trace_id),
  profileIdx: index('TelemetrySpan_tool_profile_id_idx').on(t.tool_profile_id),
  startTimeIdx: index('TelemetrySpan_start_time_idx').on(t.start_time),
  userIdx: index('TelemetrySpan_user_id_idx').on(t.user_id),
}));

export const telemetryLogs = pgTable('TelemetryLog', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  customer_id: text('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  user_id: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  tool_profile_id: text('tool_profile_id').references(() => toolProfiles.id, { onDelete: 'set null' }),
  vendor: text('vendor').notNull(),
  trace_id: text('trace_id'),
  span_id: text('span_id'),
  severity: text('severity'),
  body: text('body'),
  resource_attributes: jsonb('resource_attributes'),
  log_attributes: jsonb('log_attributes'),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
  ingested_at: timestamp('ingested_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  customerIdx: index('TelemetryLog_customer_id_idx').on(t.customer_id),
  userIdx: index('TelemetryLog_user_id_idx').on(t.user_id),
  vendorIdx: index('TelemetryLog_vendor_idx').on(t.vendor),
  timestampIdx: index('TelemetryLog_timestamp_idx').on(t.timestamp),
}));

export const telemetryMetrics = pgTable('TelemetryMetric', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  customer_id: text('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  partner_id: text('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  user_id: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  tool_profile_id: text('tool_profile_id').references(() => toolProfiles.id, { onDelete: 'set null' }),
  vendor: text('vendor').notNull(),
  service_name: text('service_name'),
  metric_name: text('metric_name').notNull(),
  metric_type: text('metric_type').notNull(),
  unit: text('unit'),
  description: text('description'),
  attributes: jsonb('attributes'),
  value_double: doublePrecision('value_double'),
  value_int: integer('value_int'),
  count: integer('count'),
  sum: doublePrecision('sum'),
  min: doublePrecision('min'),
  max: doublePrecision('max'),
  bucket_counts: jsonb('bucket_counts'),
  explicit_bounds: jsonb('explicit_bounds'),
  quantile_values: jsonb('quantile_values'),
  data_point: jsonb('data_point'),
  start_time: timestamp('start_time', { withTimezone: true }),
  time: timestamp('time', { withTimezone: true }).notNull(),
  ingested_at: timestamp('ingested_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  customerIdx: index('TelemetryMetric_customer_id_idx').on(t.customer_id),
  userIdx: index('TelemetryMetric_user_id_idx').on(t.user_id),
  profileIdx: index('TelemetryMetric_tool_profile_id_idx').on(t.tool_profile_id),
  vendorIdx: index('TelemetryMetric_vendor_idx').on(t.vendor),
  nameIdx: index('TelemetryMetric_metric_name_idx').on(t.metric_name),
  timeIdx: index('TelemetryMetric_time_idx').on(t.time),
}));

// ── Relations ────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many, one }) => ({
  accounts: many(accounts),
  sessions: many(sessions),
  ownedCustomers: many(customers),
  customer: one(customers, { fields: [users.customer_id], references: [customers.id] }),
  provenanceEvents: many(provenanceEvents),
}));

export const apiTokensRelations = relations(apiTokens, ({ one }) => ({
  customer: one(customers, { fields: [apiTokens.customer_id], references: [customers.id] }),
  user: one(users, { fields: [apiTokens.user_id], references: [users.id] }),
}));

export const customersRelations = relations(customers, ({ one, many }) => ({
  user: one(users, { fields: [customers.user_id], references: [users.id] }),
  partner: one(partners, { fields: [customers.partner_id], references: [partners.id] }),
  apiTokens: many(apiTokens),
  usageEvents: many(usageEvents),
  provenanceEvents: many(provenanceEvents),
  invites: many(invites),
  toolProfiles: many(toolProfiles),
  telemetrySpans: many(telemetrySpans),
}));

export const invitesRelations = relations(invites, ({ one }) => ({
  customer: one(customers, { fields: [invites.customer_id], references: [customers.id] }),
  invitedBy: one(users, { fields: [invites.invited_by_user_id], references: [users.id] }),
}));

export const partnersRelations = relations(partners, ({ many }) => ({
  customers: many(customers),
  usageEvents: many(usageEvents),
  provenanceEvents: many(provenanceEvents),
  toolProfiles: many(toolProfiles),
}));

export const provenanceEventsRelations = relations(provenanceEvents, ({ one, many }) => ({
  customer: one(customers, { fields: [provenanceEvents.customer_id], references: [customers.id] }),
  partner: one(partners, { fields: [provenanceEvents.partner_id], references: [partners.id] }),
  user: one(users, { fields: [provenanceEvents.user_id], references: [users.id] }),
  artifacts: many(artifactLinks),
  outcomes: many(outcomes),
}));

export const artifactLinksRelations = relations(artifactLinks, ({ one }) => ({
  event: one(provenanceEvents, { fields: [artifactLinks.event_id], references: [provenanceEvents.id] }),
}));

export const outcomesRelations = relations(outcomes, ({ one }) => ({
  event: one(provenanceEvents, { fields: [outcomes.event_id], references: [provenanceEvents.id] }),
}));

export const toolProfilesRelations = relations(toolProfiles, ({ one, many }) => ({
  customer: one(customers, { fields: [toolProfiles.customer_id], references: [customers.id] }),
  partner: one(partners, { fields: [toolProfiles.partner_id], references: [partners.id] }),
  telemetrySpans: many(telemetrySpans),
  telemetryLogs: many(telemetryLogs),
  telemetryMetrics: many(telemetryMetrics),
}));

export const telemetrySpansRelations = relations(telemetrySpans, ({ one }) => ({
  customer: one(customers, { fields: [telemetrySpans.customer_id], references: [customers.id] }),
  partner: one(partners, { fields: [telemetrySpans.partner_id], references: [partners.id] }),
  toolProfile: one(toolProfiles, { fields: [telemetrySpans.tool_profile_id], references: [toolProfiles.id] }),
}));

export const telemetryLogsRelations = relations(telemetryLogs, ({ one }) => ({
  customer: one(customers, { fields: [telemetryLogs.customer_id], references: [customers.id] }),
  toolProfile: one(toolProfiles, { fields: [telemetryLogs.tool_profile_id], references: [toolProfiles.id] }),
}));

export const telemetryMetricsRelations = relations(telemetryMetrics, ({ one }) => ({
  customer: one(customers, { fields: [telemetryMetrics.customer_id], references: [customers.id] }),
  partner: one(partners, { fields: [telemetryMetrics.partner_id], references: [partners.id] }),
  toolProfile: one(toolProfiles, { fields: [telemetryMetrics.tool_profile_id], references: [toolProfiles.id] }),
}));

export type User = typeof users.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type ToolProfile = typeof toolProfiles.$inferSelect;
export type TelemetrySpan = typeof telemetrySpans.$inferSelect;
export type TelemetryLog = typeof telemetryLogs.$inferSelect;
export type TelemetryMetric = typeof telemetryMetrics.$inferSelect;
