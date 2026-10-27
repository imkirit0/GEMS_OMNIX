-- Exports (audit 06 §3 "Exports"; 11 P7; T-SEC-006, T-SEC-015, T-RPT-010…013, T-RLS-011).
insert into app.permission (key, description, sensitive) values
  ('org.centre.export', 'Export the centre list (only centres in your scope)', false),
  ('rbac.user.export', 'Export the user list', true),
  ('pii.export', 'Include personal data columns in exports', true)
on conflict (key) do nothing;

-- Rate limit source: the actor's own export audit rows (the app role can insert audit rows but never read them).
create function app.recent_export_count(p_minutes int) returns int
language sql stable security definer set search_path = pg_catalog, app
as $$
  select count(*)::int from app.audit_log
  where user_id = app.session_user_id() and action like 'export.%' and at > now() - make_interval(mins => p_minutes)
$$;
revoke all on function app.recent_export_count(int) from public;
grant execute on function app.recent_export_count(int) to gems_app;

-- Performance (found by T-RPT-013): row filters must evaluate the caller's scope once, not per row.
-- scoped_centre_ids only returns the caller's own permitted centres (no more than RLS already reveals).
grant execute on function app.scoped_centre_ids(text) to gems_app;
alter policy rbac_read on app.app_user
  using ((select app.has_permission('rbac.view', null)) or id = (select app.session_user_id()));
alter policy rbac_read on app.role_assignment
  using ((select app.has_permission('rbac.view', null)) or user_id = (select app.session_user_id()));
