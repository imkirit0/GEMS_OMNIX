-- Centre master, read-only view (FR-022, FR-022.02). First centre-scoped record pages; T-SEC-001/005 run against them.
-- Catalogue entry only: who holds it is decided by role assignment (D-SEC-1).
insert into app.permission (key, description, sensitive)
values ('org.centre.view', 'View centre details (only centres in your scope)', false)
on conflict (key) do nothing;
