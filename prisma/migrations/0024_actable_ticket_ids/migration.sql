-- The tickets the session may act on now, as one set (docs/designs/approvals-workbench/approvals-workbench.md, DD-1;
-- measured): app.ticket_may_act (0009) per OPEN row cost 4.1 s on 2,412 open tickets for a user who may act on almost
-- nothing. The set form of the same rule; T-AW-001 compares them. Array helpers sit in sub-selects (once per query).
-- No schema change.
create function app.actable_ticket_ids() returns setof uuid
language sql stable security definer
set search_path = pg_catalog, app
as $$
  with me as (select app.session_user_id() as id),
  rc as (
    select r.role_id, unnest(app.user_centre_ids(me.id, null, r.role_id)) as centre_id
    from me, (select distinct ra.role_id from app.role_assignment ra, me where ra.user_id = me.id) r)
  select t.id
  from app.ticket t join app.ticket_level l on l.ticket_id = t.id and l.level = t.current_level, me
  where t.status = 'OPEN'
    and t.centre_id = any ((select app.visible_centre_ids())::int[])
    and t.centre_id = any ((select app.scoped_centre_ids('ticket.approve'))::int[])  -- has_permission('ticket.approve', centre)
    and t.raised_by <> me.id
    and not exists (select 1 from app.ticket_event e where e.ticket_id = t.id and e.action = 'APPROVE' and e.actor_id = me.id)
    and (t.assigned_user_id = me.id
         or (t.assigned_user_id is null
             and (l.approver_user_id = me.id
                  or exists (select 1 from rc where rc.role_id = l.approver_role_id and rc.centre_id = t.centre_id))))
$$;
revoke all on function app.actable_ticket_ids() from public;
grant execute on function app.actable_ticket_ids() to gems_app;
