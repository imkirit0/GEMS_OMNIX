-- Candidate B tables/columns (bake-off only; the winner's version becomes a real migration).
alter table app.app_user add column if not exists password_hash text;
alter table app.app_user add column if not exists requires_totp boolean not null default false;
alter table app.app_user add column if not exists totp_secret_enc text; -- AES-256-GCM, key from AUTH_ENC_KEY
alter table app.app_user add column if not exists totp_last_step bigint; -- replay protection
alter table app.app_session add column if not exists last_seen_at timestamptz not null default now();
create table if not exists app.auth_throttle (login_key text primary key, failures int not null default 0, locked_until timestamptz);
create table if not exists app.auth_ip_attempt (ip text not null, at timestamptz not null default now());
create index if not exists auth_ip_attempt_ip_at on app.auth_ip_attempt (ip, at);
create table if not exists app.auth_challenge (
  token_hash bytea primary key, user_id uuid not null references app.app_user (id) on delete cascade,
  kind text not null check (kind in ('enrol', 'totp')), pending_secret_enc text,
  expires_at timestamptz not null, used_at timestamptz);
create table if not exists app.auth_recovery_code (
  user_id uuid not null references app.app_user (id) on delete cascade, code_hash bytea not null, used_at timestamptz,
  primary key (user_id, code_hash));
create table if not exists app.auth_reset (
  token_hash bytea primary key, user_id uuid not null references app.app_user (id) on delete cascade,
  expires_at timestamptz not null, used_at timestamptz);
grant update (password_hash, totp_secret_enc, totp_last_step) on app.app_user to gems_auth;
grant select, insert, update, delete on app.auth_throttle, app.auth_ip_attempt, app.auth_challenge,
  app.auth_recovery_code, app.auth_reset to gems_auth;
