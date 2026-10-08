-- Generated from convex/schema.ts by scripts/gen-sql-schema.mjs.
-- Do not edit: run `bun run sql:schema` instead. `bun run sql:check` proves
-- this file matches the Convex schema by reading it back out of Postgres.
--
-- Read docs/PORTABILITY.md for why the port is staged, and the notes at the top
-- of the generator for the decisions taken here: bigint for every number, text
-- ids for a lossless migration, CHECK constraints instead of enum types, and
-- real foreign keys where Convex had none.
/* ------------------------------------------------- the application ---- */

CREATE TABLE organizations (
  -- Convex `_id`. Text, so a migration from a live deployment is lossless.
  id text PRIMARY KEY,
  -- Convex `_creationTime`, the paging cursor `lib/balances.ts` walks the ledger by.
  creation_time bigint NOT NULL,
  name text NOT NULL,
  slug text NOT NULL,
  plan text CHECK (plan IN ('free', 'paid')),
  closed_through bigint,
  created_at bigint NOT NULL
);

CREATE TABLE banks (
  -- Convex `_id`. Text, so a migration from a live deployment is lossless.
  id text PRIMARY KEY,
  -- Convex `_creationTime`, the paging cursor `lib/balances.ts` walks the ledger by.
  creation_time bigint NOT NULL,
  org_id text NOT NULL,
  name text NOT NULL,
  branch text,
  account_number text,
  ifsc_code text,
  upi_id text,
  notes text,
  created_at bigint NOT NULL
);

CREATE TABLE funds (
  -- Convex `_id`. Text, so a migration from a live deployment is lossless.
  id text PRIMARY KEY,
  -- Convex `_creationTime`, the paging cursor `lib/balances.ts` walks the ledger by.
  creation_time bigint NOT NULL,
  org_id text NOT NULL,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('general', 'zakat', 'charity', 'emergency', 'project', 'operational', 'investment')),
  collection_mode text CHECK (collection_mode IN ('fixed_monthly', 'voluntary', 'pledge_based', 'donation')),
  description text,
  bank_id text,
  manager_id text,
  target_amount_paise bigint,
  is_active boolean NOT NULL,
  is_member_contribution boolean NOT NULL,
  monthly_amount_paise bigint,
  created_at bigint NOT NULL
);

CREATE TABLE collection_rounds (
  -- Convex `_id`. Text, so a migration from a live deployment is lossless.
  id text PRIMARY KEY,
  -- Convex `_creationTime`, the paging cursor `lib/balances.ts` walks the ledger by.
  creation_time bigint NOT NULL,
  org_id text NOT NULL,
  fund_id text NOT NULL,
  date text NOT NULL,
  label text NOT NULL,
  note text,
  collected_by text,
  created_at bigint NOT NULL
);

CREATE TABLE pledges (
  -- Convex `_id`. Text, so a migration from a live deployment is lossless.
  id text PRIMARY KEY,
  -- Convex `_creationTime`, the paging cursor `lib/balances.ts` walks the ledger by.
  creation_time bigint NOT NULL,
  org_id text NOT NULL,
  fund_id text NOT NULL,
  member_id text,
  amount_pledged_paise bigint NOT NULL,
  status text NOT NULL CHECK (status IN ('promised', 'partial', 'fulfilled', 'cancelled')),
  note text,
  created_at bigint NOT NULL
);

CREATE TABLE members (
  -- Convex `_id`. Text, so a migration from a live deployment is lossless.
  id text PRIMARY KEY,
  -- Convex `_creationTime`, the paging cursor `lib/balances.ts` walks the ledger by.
  creation_time bigint NOT NULL,
  org_id text NOT NULL,
  user_id text,
  name text NOT NULL,
  phone text,
  email text,
  relation text,
  joined_year bigint NOT NULL,
  joined_month bigint NOT NULL,
  is_active boolean NOT NULL,
  created_at bigint NOT NULL
);

CREATE TABLE contributions (
  -- Convex `_id`. Text, so a migration from a live deployment is lossless.
  id text PRIMARY KEY,
  -- Convex `_creationTime`, the paging cursor `lib/balances.ts` walks the ledger by.
  creation_time bigint NOT NULL,
  org_id text NOT NULL,
  member_id text NOT NULL,
  fund_id text,
  year bigint NOT NULL,
  month bigint NOT NULL,
  amount_paise bigint NOT NULL,
  status text NOT NULL CHECK (status IN ('due', 'paid', 'partial', 'waived')),
  due_date text,
  waived_reason text,
  waived_by text
);

CREATE TABLE payments (
  -- Convex `_id`. Text, so a migration from a live deployment is lossless.
  id text PRIMARY KEY,
  -- Convex `_creationTime`, the paging cursor `lib/balances.ts` walks the ledger by.
  creation_time bigint NOT NULL,
  org_id text NOT NULL,
  member_id text,
  fund_id text,
  bank_id text,
  amount_paise bigint NOT NULL,
  method text NOT NULL CHECK (method IN ('cash', 'cheque', 'upi', 'card', 'transfer')),
  paid_at text NOT NULL,
  collected_by text,
  receipt_no text NOT NULL,
  reference text,
  round_id text,
  gateway_payment_id text,
  idempotency_key text,
  created_at bigint NOT NULL
);

CREATE TABLE ledger_entries (
  -- Convex `_id`. Text, so a migration from a live deployment is lossless.
  id text PRIMARY KEY,
  -- Convex `_creationTime`, the paging cursor `lib/balances.ts` walks the ledger by.
  creation_time bigint NOT NULL,
  org_id text NOT NULL,
  fund_id text,
  bank_id text,
  member_id text,
  amount_paise bigint NOT NULL,
  direction text NOT NULL CHECK (direction IN ('credit', 'debit')),
  category text NOT NULL CHECK (category IN ('operations', 'emergency', 'investment', 'donation', 'salary', 'maintenance', 'other')),
  effective_date text NOT NULL,
  source text NOT NULL CHECK (source IN ('opening', 'transaction', 'payment', 'correction', 'transfer')),
  ref_type text,
  ref_id text,
  note text,
  actor_id text,
  locked_to bigint
);

CREATE TABLE payment_requests (
  -- Convex `_id`. Text, so a migration from a live deployment is lossless.
  id text PRIMARY KEY,
  -- Convex `_creationTime`, the paging cursor `lib/balances.ts` walks the ledger by.
  creation_time bigint NOT NULL,
  org_id text NOT NULL,
  member_id text NOT NULL,
  fund_id text,
  amount_paise bigint NOT NULL,
  method text NOT NULL CHECK (method IN ('cash', 'cheque', 'upi', 'card', 'transfer')),
  paid_at text NOT NULL,
  reference text,
  note text,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by text NOT NULL,
  decided_by text,
  decided_at bigint,
  decision_note text,
  payment_id text,
  created_at bigint NOT NULL
);

CREATE TABLE transactions (
  -- Convex `_id`. Text, so a migration from a live deployment is lossless.
  id text PRIMARY KEY,
  -- Convex `_creationTime`, the paging cursor `lib/balances.ts` walks the ledger by.
  creation_time bigint NOT NULL,
  org_id text NOT NULL,
  fund_id text NOT NULL,
  type text NOT NULL CHECK (type IN ('deposit', 'withdrawal', 'transfer_in', 'transfer_out')),
  amount_paise bigint NOT NULL,
  description text NOT NULL,
  category text NOT NULL CHECK (category IN ('operations', 'emergency', 'investment', 'donation', 'salary', 'maintenance', 'other')),
  to_fund_id text,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'completed')),
  requested_by text NOT NULL,
  approved_by text,
  approval_note text,
  transaction_date text NOT NULL,
  created_at bigint NOT NULL
);

CREATE TABLE reconciliations (
  -- Convex `_id`. Text, so a migration from a live deployment is lossless.
  id text PRIMARY KEY,
  -- Convex `_creationTime`, the paging cursor `lib/balances.ts` walks the ledger by.
  creation_time bigint NOT NULL,
  org_id text NOT NULL,
  bank_id text NOT NULL,
  statement_date text NOT NULL,
  statement_balance_paise bigint NOT NULL,
  ledger_balance_paise bigint NOT NULL,
  difference_paise bigint NOT NULL,
  note text,
  resolved_at bigint,
  created_at bigint NOT NULL
);

CREATE TABLE balances (
  -- Convex `_id`. Text, so a migration from a live deployment is lossless.
  id text PRIMARY KEY,
  -- Convex `_creationTime`, the paging cursor `lib/balances.ts` walks the ledger by.
  creation_time bigint NOT NULL,
  org_id text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('fund', 'bank', 'member', 'bank_year')),
  scope_id text NOT NULL,
  amount_paise bigint NOT NULL,
  updated_at bigint NOT NULL
);

CREATE TABLE audit_log (
  -- Convex `_id`. Text, so a migration from a live deployment is lossless.
  id text PRIMARY KEY,
  -- Convex `_creationTime`, the paging cursor `lib/balances.ts` walks the ledger by.
  creation_time bigint NOT NULL,
  org_id text NOT NULL,
  user_id text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  details text,
  ip text,
  user_agent text,
  created_at bigint NOT NULL
);

CREATE TABLE counters (
  -- Convex `_id`. Text, so a migration from a live deployment is lossless.
  id text PRIMARY KEY,
  -- Convex `_creationTime`, the paging cursor `lib/balances.ts` walks the ledger by.
  creation_time bigint NOT NULL,
  org_id text NOT NULL,
  scope text NOT NULL,
  value bigint NOT NULL,
  updated_at bigint NOT NULL
);

CREATE TABLE gateway_intents (
  -- Convex `_id`. Text, so a migration from a live deployment is lossless.
  id text PRIMARY KEY,
  -- Convex `_creationTime`, the paging cursor `lib/balances.ts` walks the ledger by.
  creation_time bigint NOT NULL,
  org_id text NOT NULL,
  provider text NOT NULL,
  provider_id text NOT NULL,
  member_id text,
  fund_id text,
  round_id text,
  amount_paise bigint NOT NULL,
  contribution_ids text[] NOT NULL,
  status text NOT NULL CHECK (status IN ('created', 'captured', 'failed', 'expired')),
  created_by text,
  created_at bigint NOT NULL,
  expires_at bigint NOT NULL
);

CREATE TABLE gateway_events (
  -- Convex `_id`. Text, so a migration from a live deployment is lossless.
  id text PRIMARY KEY,
  -- Convex `_creationTime`, the paging cursor `lib/balances.ts` walks the ledger by.
  creation_time bigint NOT NULL,
  org_id text NOT NULL,
  provider text NOT NULL,
  event_id text NOT NULL,
  kind text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('succeeded', 'failed', 'refunded', 'ignored')),
  intent_id text,
  provider_payment_id text,
  amount_paise bigint NOT NULL,
  reason text,
  status text NOT NULL CHECK (status IN ('received', 'processed', 'failed')),
  received_at bigint NOT NULL,
  processed_at bigint
);

CREATE TABLE settlements (
  -- Convex `_id`. Text, so a migration from a live deployment is lossless.
  id text PRIMARY KEY,
  -- Convex `_creationTime`, the paging cursor `lib/balances.ts` walks the ledger by.
  creation_time bigint NOT NULL,
  org_id text NOT NULL,
  bank_id text,
  provider text NOT NULL,
  provider_payout_id text NOT NULL,
  amount_paise bigint NOT NULL,
  fee_paise bigint NOT NULL,
  settled_on text NOT NULL,
  created_at bigint NOT NULL
);

CREATE TABLE notification_preferences (
  -- Convex `_id`. Text, so a migration from a live deployment is lossless.
  id text PRIMARY KEY,
  -- Convex `_creationTime`, the paging cursor `lib/balances.ts` walks the ledger by.
  creation_time bigint NOT NULL,
  org_id text NOT NULL,
  member_id text NOT NULL,
  email boolean,
  sms boolean,
  whatsapp boolean,
  decided_at bigint NOT NULL,
  updated_by text
);

CREATE TABLE reminder_campaigns (
  -- Convex `_id`. Text, so a migration from a live deployment is lossless.
  id text PRIMARY KEY,
  -- Convex `_creationTime`, the paging cursor `lib/balances.ts` walks the ledger by.
  creation_time bigint NOT NULL,
  org_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('due_soon', 'overdue', 'arrears_summary')),
  period text NOT NULL,
  trigger text NOT NULL CHECK (trigger IN ('scheduled', 'manual')),
  requested_by text,
  considered bigint NOT NULL,
  queued bigint NOT NULL,
  skipped_opt_out bigint NOT NULL,
  skipped_unreachable bigint NOT NULL,
  created_at bigint NOT NULL
);

CREATE TABLE reminders (
  -- Convex `_id`. Text, so a migration from a live deployment is lossless.
  id text PRIMARY KEY,
  -- Convex `_creationTime`, the paging cursor `lib/balances.ts` walks the ledger by.
  creation_time bigint NOT NULL,
  org_id text NOT NULL,
  campaign_id text NOT NULL,
  member_id text NOT NULL,
  fund_id text,
  kind text NOT NULL CHECK (kind IN ('due_soon', 'overdue', 'arrears_summary')),
  channel text NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp')),
  destination text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  amount_paise bigint NOT NULL,
  months bigint NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'sent', 'delivered', 'failed', 'skipped')),
  reminder_id text,
  failure_reason text,
  sent_at bigint,
  delivered_at bigint,
  created_at bigint NOT NULL
);

/* ------------------------------------------------------------ auth ---- */

-- Convex Auth's tables, carried across so the schema is complete. Stage 4 of
-- the port replaces these with the chosen auth library's own tables; the
-- `users` row is the one the application reads, and it keeps `org_id`/`role`.

CREATE TABLE users (
  -- Convex `_id`. Text, so a migration from a live deployment is lossless.
  id text PRIMARY KEY,
  -- Convex `_creationTime`, the paging cursor `lib/balances.ts` walks the ledger by.
  creation_time bigint NOT NULL,
  name text,
  image text,
  email text,
  email_verification_time bigint,
  phone text,
  phone_verification_time bigint,
  is_anonymous boolean,
  org_id text,
  role text CHECK (role IN ('admin', 'treasurer', 'fund_manager', 'viewer', 'member')),
  is_active boolean
);

CREATE TABLE auth_sessions (
  -- Convex `_id`. Text, so a migration from a live deployment is lossless.
  id text PRIMARY KEY,
  -- Convex `_creationTime`, the paging cursor `lib/balances.ts` walks the ledger by.
  creation_time bigint NOT NULL,
  user_id text NOT NULL,
  expiration_time bigint NOT NULL
);

CREATE TABLE auth_accounts (
  -- Convex `_id`. Text, so a migration from a live deployment is lossless.
  id text PRIMARY KEY,
  -- Convex `_creationTime`, the paging cursor `lib/balances.ts` walks the ledger by.
  creation_time bigint NOT NULL,
  user_id text NOT NULL,
  provider text NOT NULL,
  provider_account_id text NOT NULL,
  secret text,
  email_verified text,
  phone_verified text
);

CREATE TABLE auth_refresh_tokens (
  -- Convex `_id`. Text, so a migration from a live deployment is lossless.
  id text PRIMARY KEY,
  -- Convex `_creationTime`, the paging cursor `lib/balances.ts` walks the ledger by.
  creation_time bigint NOT NULL,
  session_id text NOT NULL,
  expiration_time bigint NOT NULL,
  first_used_time bigint,
  parent_refresh_token_id text
);

CREATE TABLE auth_verification_codes (
  -- Convex `_id`. Text, so a migration from a live deployment is lossless.
  id text PRIMARY KEY,
  -- Convex `_creationTime`, the paging cursor `lib/balances.ts` walks the ledger by.
  creation_time bigint NOT NULL,
  account_id text NOT NULL,
  provider text NOT NULL,
  code text NOT NULL,
  expiration_time bigint NOT NULL,
  verifier text,
  email_verified text,
  phone_verified text
);

CREATE TABLE auth_verifiers (
  -- Convex `_id`. Text, so a migration from a live deployment is lossless.
  id text PRIMARY KEY,
  -- Convex `_creationTime`, the paging cursor `lib/balances.ts` walks the ledger by.
  creation_time bigint NOT NULL,
  session_id text,
  signature text
);

CREATE TABLE auth_rate_limits (
  -- Convex `_id`. Text, so a migration from a live deployment is lossless.
  id text PRIMARY KEY,
  -- Convex `_creationTime`, the paging cursor `lib/balances.ts` walks the ledger by.
  creation_time bigint NOT NULL,
  identifier text NOT NULL,
  last_attempt_time bigint NOT NULL,
  attempts_left bigint NOT NULL
);

/* ----------------------------------------------------- constraints ---- */

-- Added after every table exists, so the order of the sections above cannot
-- matter. Cascades on `org_id` only: see the note on `foreignKeysFor`.

-- banks
ALTER TABLE banks ADD CONSTRAINT banks_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;

-- funds
ALTER TABLE funds ADD CONSTRAINT funds_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE funds ADD CONSTRAINT funds_bank_id_fkey FOREIGN KEY (bank_id) REFERENCES banks(id);
ALTER TABLE funds ADD CONSTRAINT funds_manager_id_fkey FOREIGN KEY (manager_id) REFERENCES users(id);

-- collectionRounds
ALTER TABLE collection_rounds ADD CONSTRAINT collection_rounds_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE collection_rounds ADD CONSTRAINT collection_rounds_fund_id_fkey FOREIGN KEY (fund_id) REFERENCES funds(id);
ALTER TABLE collection_rounds ADD CONSTRAINT collection_rounds_collected_by_fkey FOREIGN KEY (collected_by) REFERENCES users(id);

-- pledges
ALTER TABLE pledges ADD CONSTRAINT pledges_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE pledges ADD CONSTRAINT pledges_fund_id_fkey FOREIGN KEY (fund_id) REFERENCES funds(id);
ALTER TABLE pledges ADD CONSTRAINT pledges_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id);

-- members
ALTER TABLE members ADD CONSTRAINT members_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE members ADD CONSTRAINT members_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);

-- contributions
ALTER TABLE contributions ADD CONSTRAINT contributions_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE contributions ADD CONSTRAINT contributions_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id);
ALTER TABLE contributions ADD CONSTRAINT contributions_fund_id_fkey FOREIGN KEY (fund_id) REFERENCES funds(id);
ALTER TABLE contributions ADD CONSTRAINT contributions_waived_by_fkey FOREIGN KEY (waived_by) REFERENCES users(id);

-- payments
ALTER TABLE payments ADD CONSTRAINT payments_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE payments ADD CONSTRAINT payments_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id);
ALTER TABLE payments ADD CONSTRAINT payments_fund_id_fkey FOREIGN KEY (fund_id) REFERENCES funds(id);
ALTER TABLE payments ADD CONSTRAINT payments_bank_id_fkey FOREIGN KEY (bank_id) REFERENCES banks(id);
ALTER TABLE payments ADD CONSTRAINT payments_collected_by_fkey FOREIGN KEY (collected_by) REFERENCES users(id);
ALTER TABLE payments ADD CONSTRAINT payments_round_id_fkey FOREIGN KEY (round_id) REFERENCES collection_rounds(id);

-- ledgerEntries
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_fund_id_fkey FOREIGN KEY (fund_id) REFERENCES funds(id);
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_bank_id_fkey FOREIGN KEY (bank_id) REFERENCES banks(id);
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id);
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES users(id);

-- paymentRequests
ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id);
ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_fund_id_fkey FOREIGN KEY (fund_id) REFERENCES funds(id);
ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES users(id);
ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES users(id);
ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES payments(id);

-- transactions
ALTER TABLE transactions ADD CONSTRAINT transactions_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE transactions ADD CONSTRAINT transactions_fund_id_fkey FOREIGN KEY (fund_id) REFERENCES funds(id);
ALTER TABLE transactions ADD CONSTRAINT transactions_to_fund_id_fkey FOREIGN KEY (to_fund_id) REFERENCES funds(id);
ALTER TABLE transactions ADD CONSTRAINT transactions_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES users(id);
ALTER TABLE transactions ADD CONSTRAINT transactions_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES users(id);

-- reconciliations
ALTER TABLE reconciliations ADD CONSTRAINT reconciliations_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE reconciliations ADD CONSTRAINT reconciliations_bank_id_fkey FOREIGN KEY (bank_id) REFERENCES banks(id);

-- balances
ALTER TABLE balances ADD CONSTRAINT balances_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;

-- auditLog
ALTER TABLE audit_log ADD CONSTRAINT audit_log_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);

-- counters
ALTER TABLE counters ADD CONSTRAINT counters_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;

-- gatewayIntents
ALTER TABLE gateway_intents ADD CONSTRAINT gateway_intents_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE gateway_intents ADD CONSTRAINT gateway_intents_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id);
ALTER TABLE gateway_intents ADD CONSTRAINT gateway_intents_fund_id_fkey FOREIGN KEY (fund_id) REFERENCES funds(id);
ALTER TABLE gateway_intents ADD CONSTRAINT gateway_intents_round_id_fkey FOREIGN KEY (round_id) REFERENCES collection_rounds(id);
ALTER TABLE gateway_intents ADD CONSTRAINT gateway_intents_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id);

-- gatewayEvents
ALTER TABLE gateway_events ADD CONSTRAINT gateway_events_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE gateway_events ADD CONSTRAINT gateway_events_intent_id_fkey FOREIGN KEY (intent_id) REFERENCES gateway_intents(id);

-- settlements
ALTER TABLE settlements ADD CONSTRAINT settlements_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE settlements ADD CONSTRAINT settlements_bank_id_fkey FOREIGN KEY (bank_id) REFERENCES banks(id);

-- notificationPreferences
ALTER TABLE notification_preferences ADD CONSTRAINT notification_preferences_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE notification_preferences ADD CONSTRAINT notification_preferences_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id);
ALTER TABLE notification_preferences ADD CONSTRAINT notification_preferences_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES users(id);

-- reminderCampaigns
ALTER TABLE reminder_campaigns ADD CONSTRAINT reminder_campaigns_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE reminder_campaigns ADD CONSTRAINT reminder_campaigns_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES users(id);

-- reminders
ALTER TABLE reminders ADD CONSTRAINT reminders_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE reminders ADD CONSTRAINT reminders_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES reminder_campaigns(id);
ALTER TABLE reminders ADD CONSTRAINT reminders_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id);
ALTER TABLE reminders ADD CONSTRAINT reminders_fund_id_fkey FOREIGN KEY (fund_id) REFERENCES funds(id);

-- users
ALTER TABLE users ADD CONSTRAINT users_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;

-- authSessions
ALTER TABLE auth_sessions ADD CONSTRAINT auth_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);

-- authAccounts
ALTER TABLE auth_accounts ADD CONSTRAINT auth_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);

-- authRefreshTokens
ALTER TABLE auth_refresh_tokens ADD CONSTRAINT auth_refresh_tokens_session_id_fkey FOREIGN KEY (session_id) REFERENCES auth_sessions(id);
ALTER TABLE auth_refresh_tokens ADD CONSTRAINT auth_refresh_tokens_parent_refresh_token_id_fkey FOREIGN KEY (parent_refresh_token_id) REFERENCES auth_refresh_tokens(id);

-- authVerificationCodes
ALTER TABLE auth_verification_codes ADD CONSTRAINT auth_verification_codes_account_id_fkey FOREIGN KEY (account_id) REFERENCES auth_accounts(id);

-- authVerifiers
ALTER TABLE auth_verifiers ADD CONSTRAINT auth_verifiers_session_id_fkey FOREIGN KEY (session_id) REFERENCES auth_sessions(id);

/* --------------------------------------------------------- indexes ---- */

-- One per Convex index, same columns in the same order. Convex index names
-- repeat across tables (`by_org` is on nine of them), so they are prefixed.

-- organizations
CREATE INDEX organizations_0 ON organizations (slug);

-- banks
CREATE INDEX banks_0 ON banks (org_id);

-- funds
CREATE INDEX funds_0 ON funds (org_id);
CREATE INDEX funds_1 ON funds (org_id, manager_id);
CREATE INDEX funds_2 ON funds (org_id, bank_id);

-- collectionRounds
CREATE INDEX collection_rounds_0 ON collection_rounds (org_id, fund_id, date);
CREATE INDEX collection_rounds_1 ON collection_rounds (org_id);

-- pledges
CREATE INDEX pledges_0 ON pledges (org_id, fund_id);
CREATE INDEX pledges_1 ON pledges (org_id, member_id);
CREATE INDEX pledges_2 ON pledges (org_id);

-- members
CREATE INDEX members_0 ON members (org_id);
CREATE INDEX members_1 ON members (org_id, user_id);
CREATE INDEX members_2 ON members (org_id, email);

-- contributions
CREATE INDEX contributions_0 ON contributions (org_id, year);
CREATE INDEX contributions_1 ON contributions (org_id, year, fund_id);
CREATE INDEX contributions_2 ON contributions (org_id, member_id);
CREATE INDEX contributions_3 ON contributions (org_id, status, year);
CREATE INDEX contributions_4 ON contributions (org_id);

-- payments
CREATE INDEX payments_0 ON payments (org_id);
CREATE INDEX payments_1 ON payments (org_id, member_id);
CREATE INDEX payments_2 ON payments (org_id, round_id);
CREATE INDEX payments_3 ON payments (gateway_payment_id);
CREATE INDEX payments_4 ON payments (idempotency_key);

-- ledgerEntries
CREATE INDEX ledger_entries_0 ON ledger_entries (org_id, fund_id);
CREATE INDEX ledger_entries_1 ON ledger_entries (org_id, bank_id);
CREATE INDEX ledger_entries_2 ON ledger_entries (org_id, member_id);
CREATE INDEX ledger_entries_3 ON ledger_entries (org_id, effective_date);
CREATE INDEX ledger_entries_4 ON ledger_entries (org_id, fund_id, effective_date);
CREATE INDEX ledger_entries_5 ON ledger_entries (org_id, ref_type, ref_id);
CREATE INDEX ledger_entries_6 ON ledger_entries (org_id);

-- paymentRequests
CREATE INDEX payment_requests_0 ON payment_requests (org_id, status);
CREATE INDEX payment_requests_1 ON payment_requests (org_id, member_id);
CREATE INDEX payment_requests_2 ON payment_requests (org_id, requested_by, created_at);
CREATE INDEX payment_requests_3 ON payment_requests (org_id);

-- transactions
CREATE INDEX transactions_0 ON transactions (org_id, status);
CREATE INDEX transactions_1 ON transactions (org_id, fund_id);
CREATE INDEX transactions_2 ON transactions (org_id);

-- reconciliations
CREATE INDEX reconciliations_0 ON reconciliations (org_id, bank_id);
CREATE INDEX reconciliations_1 ON reconciliations (org_id);

-- balances
CREATE INDEX balances_0 ON balances (org_id, scope);
CREATE INDEX balances_1 ON balances (org_id);

-- auditLog
CREATE INDEX audit_log_0 ON audit_log (org_id, created_at);
CREATE INDEX audit_log_1 ON audit_log (org_id, entity_type, entity_id);

-- counters
CREATE INDEX counters_0 ON counters (org_id, scope);

-- gatewayIntents
CREATE INDEX gateway_intents_0 ON gateway_intents (org_id);
CREATE INDEX gateway_intents_1 ON gateway_intents (org_id, provider, provider_id);
CREATE INDEX gateway_intents_2 ON gateway_intents (org_id, member_id);

-- gatewayEvents
CREATE INDEX gateway_events_0 ON gateway_events (org_id, provider, event_id);
CREATE INDEX gateway_events_1 ON gateway_events (org_id, received_at);
CREATE INDEX gateway_events_2 ON gateway_events (org_id, intent_id);

-- settlements
CREATE INDEX settlements_0 ON settlements (org_id, provider, provider_payout_id);
CREATE INDEX settlements_1 ON settlements (org_id, bank_id, settled_on);
CREATE INDEX settlements_2 ON settlements (org_id);

-- notificationPreferences
CREATE INDEX notification_preferences_0 ON notification_preferences (org_id);
CREATE INDEX notification_preferences_1 ON notification_preferences (org_id, member_id);

-- reminderCampaigns
CREATE INDEX reminder_campaigns_0 ON reminder_campaigns (org_id);
CREATE INDEX reminder_campaigns_1 ON reminder_campaigns (org_id, kind, period);
CREATE INDEX reminder_campaigns_2 ON reminder_campaigns (org_id, created_at);

-- reminders
CREATE INDEX reminders_0 ON reminders (org_id, campaign_id);
CREATE INDEX reminders_1 ON reminders (org_id, member_id);
CREATE INDEX reminders_2 ON reminders (org_id, created_at);
CREATE INDEX reminders_3 ON reminders (org_id, reminder_id);
CREATE INDEX reminders_4 ON reminders (org_id, member_id, kind, created_at);

-- users
CREATE INDEX users_0 ON users (email);
CREATE INDEX users_1 ON users (phone);
CREATE INDEX users_2 ON users (org_id);
CREATE INDEX users_3 ON users (org_id, role);

-- authSessions
CREATE INDEX auth_sessions_0 ON auth_sessions (user_id);

-- authAccounts
CREATE INDEX auth_accounts_0 ON auth_accounts (user_id, provider);
CREATE INDEX auth_accounts_1 ON auth_accounts (provider, provider_account_id);

-- authRefreshTokens
CREATE INDEX auth_refresh_tokens_0 ON auth_refresh_tokens (session_id);
CREATE INDEX auth_refresh_tokens_1 ON auth_refresh_tokens (session_id, parent_refresh_token_id);

-- authVerificationCodes
CREATE INDEX auth_verification_codes_0 ON auth_verification_codes (account_id);
CREATE INDEX auth_verification_codes_1 ON auth_verification_codes (code);

-- authVerifiers
CREATE INDEX auth_verifiers_0 ON auth_verifiers (signature);

-- authRateLimits
CREATE INDEX auth_rate_limits_0 ON auth_rate_limits (identifier);
