-- The tickets the session may view, as one set (docs/designs/ticket-management/ticket-management.md, Cost; measured):
-- app.ticket_may_view (0009) per row costs ~2 ms through the definer, so a user without ticket.view paid 13 s for one
-- centre's 5.5k tickets. This computes each of its branches once per query; the rows are the same by construction
-- (T-TM-003 compares them). The array functions sit in sub-selects so they run once, not per row. No schema change.
create function app.visible_ticket_ids() returns setof uuid
language sql stable security definer
set search_path = pg_catalog, app
as $$
  with me as (select app.session_user_id() as id),
  -- the centres where each of my roles applies (ticket_may_view's user_centre_ids(me, null, role), once per role)
  rc as (
    select r.role_id, unnest(app.user_centre_ids(me.id, null, r.role_id)) as centre_id
    from me, (select distinct ra.role_id from app.role_assignment ra, me where ra.user_id = me.id) r),
  cand as (
    select t.id from app.ticket t where t.centre_id = any ((select app.scoped_centre_ids('ticket.view'))::int[])
    union select t.id from app.ticket t, me where t.raised_by = me.id
    union select l.ticket_id from app.ticket_level l, me where l.approver_user_id = me.id
    union select l.ticket_id from app.ticket_level l join rc on rc.role_id = l.approver_role_id and rc.centre_id = l.centre_id
    union select e.ticket_id from app.ticket_event e, me where e.to_user_id = me.id
    union select t.id from app.ticket t join app.ticket_type_viewer v on v.type_id = t.type_id, me where v.user_id = me.id
    union select t.id from app.ticket t join app.ticket_type_viewer v on v.type_id = t.type_id
      join rc on rc.role_id = v.role_id and rc.centre_id = t.centre_id)
  select c.id from cand c join app.ticket t on t.id = c.id
  where t.centre_id = any ((select app.visible_centre_ids())::int[])
$$;
revoke all on function app.visible_ticket_ids() from public;
grant execute on function app.visible_ticket_ids() to gems_app;
