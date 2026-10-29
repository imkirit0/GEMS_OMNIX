-- The system administrator holds every permission (project owner, 2026-10-29; PMC under D-SEC-1).
-- app.rbac_set_role_permissions lets an administrator grant only permissions they hold network-wide (0005), so
-- without this no business permission could ever be granted through the app. Every grant stays audited, and the
-- sensitive permissions keep TOTP mandatory for the role's holders. A later migration that adds a permission
-- grants it to system_admin the same way (checked in tests/admin-http.test.ts).
insert into app.role_permission (role_id, permission_key)
  select r.id, p.key from app.role r cross join app.permission p where r.key = 'system_admin'
on conflict do nothing;
