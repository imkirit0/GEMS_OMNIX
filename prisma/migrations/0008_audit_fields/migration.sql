-- Complete audit field set (T-AUD-001), redaction (T-AUD-005), and a single write path for app audit rows.

-- Generated part (prisma migrate diff)
ALTER TABLE "app"."audit_log" ADD COLUMN     "actor_kind" TEXT NOT NULL DEFAULT 'user',
ADD COLUMN     "actor_roles" TEXT[],
ADD COLUMN     "actor_scope" INTEGER[],
ADD COLUMN     "after" JSONB,
ADD COLUMN     "before" JSONB,
ADD COLUMN     "client_ip" TEXT,
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "request_id" TEXT,
ADD COLUMN     "session_hash" BYTEA;

-- ---------- Hand-written ----------

-- Mask personal identifiers and secrets anywhere in a JSON document, by key name (T-AUD-005).
create function app.redact(p jsonb) returns jsonb
language sql immutable set search_path = pg_catalog
as $$
  select case jsonb_typeof(p)
    when 'object' then coalesce((
      select jsonb_object_agg(k, case when k ~* '^(aadhaa?r.*|pan|pan_?(no|number|card)|bank_?account.*|account_?(no|number)|ifsc.*|password.*|.*secret.*|.*token.*|totp.*|otp|salt|api_?key|recovery_?codes?)$'
                                      then '"[redacted]"'::jsonb else app.redact(v) end)
      from jsonb_each(p) e(k, v)), '{}'::jsonb)
    when 'array' then coalesce((select jsonb_agg(app.redact(v)) from jsonb_array_elements(p) a(v)), '[]'::jsonb)
    else p end
$$;

-- The only way the app writes audit rows. Actor, session, roles, scope, request id and client ip come from the
-- session and transaction settings, never from the caller, so a bug cannot attribute an action to someone else.
create function app.audit(p_action text, p_outcome app."AuditOutcome", p_target_centre_id int, p_target_type text,
  p_target_id text, p_reason text, p_before jsonb, p_after jsonb, p_detail jsonb) returns void
language sql security definer set search_path = pg_catalog, app
as $$
  insert into app.audit_log (user_id, action, outcome, target_centre_id, target_type, target_id, reason, before, after, detail,
                             session_hash, actor_roles, actor_scope, request_id, client_ip, actor_kind)
  select app.session_user_id(), p_action, p_outcome, p_target_centre_id, p_target_type, p_target_id, nullif(p_reason, ''),
         app.redact(p_before), app.redact(p_after), app.redact(coalesce(p_detail, '{}'::jsonb)),
         sha256(convert_to(nullif(current_setting('app.session_id', true), ''), 'UTF8')),
         (select coalesce(array_agg(distinct r.key order by r.key), '{}') from app.role_assignment ra join app.role r on r.id = ra.role_id
           where ra.user_id = app.session_user_id()),
         app.visible_centre_ids(),
         nullif(current_setting('app.request_id', true), ''),
         nullif(current_setting('app.client_ip', true), ''),
         'user'
$$;
revoke all on function app.audit(text, app."AuditOutcome", int, text, text, text, jsonb, jsonb, jsonb) from public;
grant execute on function app.audit(text, app."AuditOutcome", int, text, text, text, jsonb, jsonb, jsonb) to gems_app, gems_job;

-- Direct inserts are no longer allowed for the app and job roles (the auth role, which runs before any session, keeps its own).
revoke insert on app.audit_log from gems_app, gems_job;
