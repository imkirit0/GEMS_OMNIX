-- Catalogue masters pages (docs/designs/catalogue-masters/catalogue-masters.md): a catalogue manager sets a centre's
-- class (DD-2). Only centre_class_id becomes writable; the policy is 0012's setup_update. No schema change.
grant update (centre_class_id) on app.centre to gems_app;
create policy setup_update on app.centre for update
  using ((select app.has_permission('catalogue.manage', null)))
  with check ((select app.has_permission('catalogue.manage', null)));
