-- Test-only (ticket engine, design item 18): applied by the admin connection, never by migrations.
-- The domain table of the test.counter handler. No centre_id, so no RLS; tests use unique keys.
create table if not exists app.test_ticket_counter (key text primary key, value int not null);
grant select, insert, update on app.test_ticket_counter to gems_app;
