-- Ticket and approval engine, Stage 2 core (docs/designs/ticket-engine/ticket-engine.md, Approved 2026-10-28).
-- Tables, keys and foreign keys are generated (prisma migrate diff); the security layer is hand-written below.

-- Generated part (prisma migrate diff). FAILED is added first and is not used anywhere in this migration,
-- because a value added by ALTER TYPE cannot be used before the transaction commits.
-- AlterEnum
ALTER TYPE "app"."AuditOutcome" ADD VALUE 'FAILED';

-- CreateEnum
CREATE TYPE "app"."TicketStatus" AS ENUM ('OPEN', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "app"."TicketAction" AS ENUM ('RAISE', 'APPROVE', 'REJECT', 'FORWARD');

-- CreateEnum
CREATE TYPE "app"."TicketPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateTable
CREATE TABLE "app"."ticket_category" (
    "id" SERIAL NOT NULL,
    "parent_id" INTEGER,
    "name" TEXT NOT NULL,

    CONSTRAINT "ticket_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."ticket_type" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category_id" INTEGER NOT NULL,
    "priority" "app"."TicketPriority" NOT NULL DEFAULT 'MEDIUM',
    "document_required" BOOLEAN NOT NULL DEFAULT false,
    "handler_key" TEXT NOT NULL,
    "number_prefix" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ticket_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."ticket_type_level" (
    "type_id" INTEGER NOT NULL,
    "level" INTEGER NOT NULL,
    "approver_user_id" UUID,
    "approver_role_id" INTEGER,

    CONSTRAINT "ticket_type_level_pkey" PRIMARY KEY ("type_id","level")
);

-- CreateTable
CREATE TABLE "app"."ticket_type_viewer" (
    "id" SERIAL NOT NULL,
    "type_id" INTEGER NOT NULL,
    "user_id" UUID,
    "role_id" INTEGER,

    CONSTRAINT "ticket_type_viewer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."ticket" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "type_id" INTEGER NOT NULL,
    "centre_id" INTEGER NOT NULL,
    "raised_by" UUID NOT NULL,
    "status" "app"."TicketStatus" NOT NULL DEFAULT 'OPEN',
    "current_level" INTEGER NOT NULL DEFAULT 1,
    "level_count" INTEGER NOT NULL,
    "assigned_user_id" UUID,
    "payload" JSONB NOT NULL,
    "reraise_of" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ,

    CONSTRAINT "ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."ticket_level" (
    "ticket_id" UUID NOT NULL,
    "centre_id" INTEGER NOT NULL,
    "level" INTEGER NOT NULL,
    "approver_user_id" UUID,
    "approver_role_id" INTEGER,

    CONSTRAINT "ticket_level_pkey" PRIMARY KEY ("ticket_id","level")
);

-- CreateTable
CREATE TABLE "app"."ticket_event" (
    "id" BIGSERIAL NOT NULL,
    "ticket_id" UUID NOT NULL,
    "centre_id" INTEGER NOT NULL,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_id" UUID NOT NULL,
    "action" "app"."TicketAction" NOT NULL,
    "level" INTEGER NOT NULL,
    "remarks" TEXT,
    "to_user_id" UUID,
    "detail" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "ticket_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."ticket_upload" (
    "id" UUID NOT NULL,
    "centre_id" INTEGER NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "declared_size" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_upload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."ticket_document" (
    "id" BIGSERIAL NOT NULL,
    "ticket_id" UUID NOT NULL,
    "centre_id" INTEGER NOT NULL,
    "upload_id" UUID NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."ticket_number_series" (
    "period" TEXT NOT NULL,
    "current" BIGINT NOT NULL,

    CONSTRAINT "ticket_number_series_pkey" PRIMARY KEY ("period")
);

-- CreateIndex
CREATE UNIQUE INDEX "ticket_type_code_key" ON "app"."ticket_type"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_type_viewer_type_id_user_id_key" ON "app"."ticket_type_viewer"("type_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_type_viewer_type_id_role_id_key" ON "app"."ticket_type_viewer"("type_id", "role_id");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_number_key" ON "app"."ticket"("number");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_reraise_of_key" ON "app"."ticket"("reraise_of");

-- CreateIndex
CREATE INDEX "ticket_status_created_at_id_idx" ON "app"."ticket"("status", "created_at", "id");

-- CreateIndex
CREATE INDEX "ticket_created_at_id_idx" ON "app"."ticket"("created_at" DESC, "id");

-- CreateIndex
CREATE INDEX "ticket_event_ticket_id_idx" ON "app"."ticket_event"("ticket_id");

-- CreateIndex
CREATE INDEX "ticket_upload_uploaded_by_created_at_idx" ON "app"."ticket_upload"("uploaded_by", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_document_upload_id_key" ON "app"."ticket_document"("upload_id");

-- CreateIndex
CREATE INDEX "ticket_document_ticket_id_idx" ON "app"."ticket_document"("ticket_id");

-- AddForeignKey
ALTER TABLE "app"."ticket_category" ADD CONSTRAINT "ticket_category_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "app"."ticket_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ticket_type" ADD CONSTRAINT "ticket_type_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "app"."ticket_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ticket_type_level" ADD CONSTRAINT "ticket_type_level_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "app"."ticket_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ticket_type_level" ADD CONSTRAINT "ticket_type_level_approver_user_id_fkey" FOREIGN KEY ("approver_user_id") REFERENCES "app"."app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ticket_type_level" ADD CONSTRAINT "ticket_type_level_approver_role_id_fkey" FOREIGN KEY ("approver_role_id") REFERENCES "app"."role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ticket_type_viewer" ADD CONSTRAINT "ticket_type_viewer_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "app"."ticket_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ticket_type_viewer" ADD CONSTRAINT "ticket_type_viewer_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app"."app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ticket_type_viewer" ADD CONSTRAINT "ticket_type_viewer_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "app"."role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ticket" ADD CONSTRAINT "ticket_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "app"."ticket_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ticket" ADD CONSTRAINT "ticket_centre_id_fkey" FOREIGN KEY ("centre_id") REFERENCES "app"."centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ticket" ADD CONSTRAINT "ticket_raised_by_fkey" FOREIGN KEY ("raised_by") REFERENCES "app"."app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ticket" ADD CONSTRAINT "ticket_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "app"."app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ticket" ADD CONSTRAINT "ticket_reraise_of_fkey" FOREIGN KEY ("reraise_of") REFERENCES "app"."ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ticket_level" ADD CONSTRAINT "ticket_level_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "app"."ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ticket_level" ADD CONSTRAINT "ticket_level_centre_id_fkey" FOREIGN KEY ("centre_id") REFERENCES "app"."centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ticket_level" ADD CONSTRAINT "ticket_level_approver_user_id_fkey" FOREIGN KEY ("approver_user_id") REFERENCES "app"."app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ticket_level" ADD CONSTRAINT "ticket_level_approver_role_id_fkey" FOREIGN KEY ("approver_role_id") REFERENCES "app"."role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ticket_event" ADD CONSTRAINT "ticket_event_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "app"."ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ticket_event" ADD CONSTRAINT "ticket_event_centre_id_fkey" FOREIGN KEY ("centre_id") REFERENCES "app"."centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ticket_event" ADD CONSTRAINT "ticket_event_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "app"."app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ticket_event" ADD CONSTRAINT "ticket_event_to_user_id_fkey" FOREIGN KEY ("to_user_id") REFERENCES "app"."app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ticket_upload" ADD CONSTRAINT "ticket_upload_centre_id_fkey" FOREIGN KEY ("centre_id") REFERENCES "app"."centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ticket_upload" ADD CONSTRAINT "ticket_upload_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "app"."app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ticket_document" ADD CONSTRAINT "ticket_document_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "app"."ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ticket_document" ADD CONSTRAINT "ticket_document_centre_id_fkey" FOREIGN KEY ("centre_id") REFERENCES "app"."centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ticket_document" ADD CONSTRAINT "ticket_document_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "app"."ticket_upload"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Hand-written ----------

-- Shape checks (design §Data model)
alter table app.ticket_type_level add constraint ticket_type_level_one_approver
  check ((approver_user_id is null) <> (approver_role_id is null));
alter table app.ticket_type_level add constraint ticket_type_level_range check (level between 1 and 4);
alter table app.ticket_type_viewer add constraint ticket_type_viewer_one_subject
  check ((user_id is null) <> (role_id is null));
alter table app.ticket_level add constraint ticket_level_one_approver
  check ((approver_user_id is null) <> (approver_role_id is null));
alter table app.ticket_level add constraint ticket_level_range check (level between 1 and 4);
alter table app.ticket add constraint ticket_level_bounds
  check (level_count between 1 and 4 and current_level between 1 and level_count);
alter table app.ticket add constraint ticket_closed_shape
  check ((status = 'OPEN') = (closed_at is null));

-- ---------- Row-level security ----------
-- Per-ticket tables: ENABLE + FORCE + a policy per command (T-RLS-002), as in 0002.
do $$
declare t text;
begin
  foreach t in array array['ticket', 'ticket_level', 'ticket_event', 'ticket_upload', 'ticket_document'] loop
    execute format('alter table app.%I enable row level security', t);
    execute format('alter table app.%I force row level security', t);
    execute format('create policy scope_select on app.%I for select using (centre_id = any ((select app.visible_centre_ids())::int[]))', t);
    execute format('create policy scope_insert on app.%I for insert with check (centre_id = any ((select app.visible_centre_ids())::int[]))', t);
    execute format('create policy scope_update on app.%I for update using (centre_id = any ((select app.visible_centre_ids())::int[])) with check (centre_id = any ((select app.visible_centre_ids())::int[]))', t);
    execute format('create policy scope_delete on app.%I for delete using (centre_id = any ((select app.visible_centre_ids())::int[]))', t);
  end loop;
end $$;

-- Setup tables apply to every centre: everyone may read, only ticket.type.manage (network-wide) may write.
-- The permission check is wrapped in select so it runs once per statement (0007).
do $$
declare t text;
begin
  foreach t in array array['ticket_category', 'ticket_type', 'ticket_type_level', 'ticket_type_viewer'] loop
    execute format('alter table app.%I enable row level security', t);
    execute format('alter table app.%I force row level security', t);
    execute format('create policy setup_select on app.%I for select using (true)', t);
    execute format('create policy setup_insert on app.%I for insert with check ((select app.has_permission(''ticket.type.manage'', null)))', t);
    execute format('create policy setup_update on app.%I for update using ((select app.has_permission(''ticket.type.manage'', null))) with check ((select app.has_permission(''ticket.type.manage'', null)))', t);
    execute format('create policy setup_delete on app.%I for delete using ((select app.has_permission(''ticket.type.manage'', null)))', t);
  end loop;
end $$;

-- ---------- Guard triggers (the database half of DD-1) ----------
-- They enforce legal states and transitions for any writer. Who may act is the engine's job.
-- A refusal is SQLSTATE P0001; the engine does not map it (a refusal means an engine bug).
create function app.ticket_guard() returns trigger
language plpgsql set search_path = pg_catalog, app
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'OPEN' or new.current_level <> 1 or new.version <> 1
       or new.assigned_user_id is not null or new.closed_at is not null then
      raise exception 'ticket must be inserted OPEN at level 1, version 1, unassigned';
    end if;
    return new;
  end if;
  if old.status <> 'OPEN' then
    raise exception 'ticket % is closed', old.id;
  end if;
  if new.version <> old.version + 1 then
    raise exception 'ticket update must add exactly 1 to version';
  end if;
  if (new.number, new.type_id, new.centre_id, new.raised_by, new.payload, new.level_count, new.reraise_of, new.created_at)
     is distinct from (old.number, old.type_id, old.centre_id, old.raised_by, old.payload, old.level_count, old.reraise_of, old.created_at) then
    raise exception 'ticket identity columns cannot change';
  end if;
  if new.current_level not in (old.current_level, old.current_level + 1) then
    raise exception 'ticket level may only stay or rise by one';
  end if;
  if new.current_level = old.current_level + 1 and new.assigned_user_id is not null then
    raise exception 'ticket assignment must be cleared when the level rises';
  end if;
  if new.status = 'APPROVED' and (old.current_level <> old.level_count or new.current_level <> old.current_level) then
    raise exception 'ticket can be approved only at its last level';
  end if;
  if new.status <> 'OPEN' and new.current_level <> old.current_level then
    raise exception 'ticket level cannot change when it closes';
  end if;
  return new;
end $$;
create trigger ticket_guard before insert or update on app.ticket
  for each row execute function app.ticket_guard();

-- Levels are written only by the raise, before its RAISE event, and never past level_count.
-- Runs as the caller: a ticket the caller cannot see gives null and is refused (fail closed).
create function app.ticket_level_guard() returns trigger
language plpgsql set search_path = pg_catalog, app
as $$
begin
  if not coalesce(new.level <= (select level_count from app.ticket where id = new.ticket_id), false) then
    raise exception 'ticket level % is outside the ticket', new.level;
  end if;
  if exists (select 1 from app.ticket_event where ticket_id = new.ticket_id) then
    raise exception 'ticket levels are fixed once the ticket is raised';
  end if;
  return new;
end $$;
create trigger ticket_level_guard before insert on app.ticket_level
  for each row execute function app.ticket_level_guard();

-- Append-only history and document links (pattern of app.audit_immutable(), naming the table).
create function app.ticket_immutable() returns trigger
language plpgsql set search_path = pg_catalog
as $$ begin raise exception '% is append-only', tg_table_name; end $$;
create trigger ticket_event_no_update_delete before update or delete on app.ticket_event
  for each row execute function app.ticket_immutable();
create trigger ticket_event_no_truncate before truncate on app.ticket_event
  for each statement execute function app.ticket_immutable();
create trigger ticket_document_no_update_delete before update or delete on app.ticket_document
  for each row execute function app.ticket_immutable();
create trigger ticket_document_no_truncate before truncate on app.ticket_document
  for each statement execute function app.ticket_immutable();

-- ---------- Eligibility and visibility (design §Eligibility and visibility) ----------

-- Internal: centres covered by p_user's assignments, optionally only those whose role has p_permission
-- and/or is p_role. Same ALL/REGION/AREA/CENTRE join as app.scoped_centre_ids (0002). Granted to no app role.
create function app.user_centre_ids(p_user uuid, p_permission text default null, p_role int default null) returns int[]
language sql stable security definer
set search_path = pg_catalog, app
as $$
  select coalesce(array_agg(distinct c.id), '{}')
  from app.role_assignment ra
  cross join app.centre c
  join app.area a on a.id = c.area_id
  where ra.user_id = p_user
    and (p_role is null or ra.role_id = p_role)
    and (p_permission is null or exists (
          select 1 from app.role_permission rp
          where rp.role_id = ra.role_id and rp.permission_key = p_permission))
    and (ra.scope_kind = 'ALL'
      or (ra.scope_kind = 'REGION' and a.region_id = ra.region_id)
      or (ra.scope_kind = 'AREA' and c.area_id = ra.area_id)
      or (ra.scope_kind = 'CENTRE' and c.id = ra.scope_centre_id))
$$;

-- Rule 1: may the actor act on this ticket now? Self-approval (Q4) and distinct approvers (DD-14) are
-- built in, so turning either off needs a migration. No user parameter: it cannot be asked about others.
create function app.ticket_may_act(p_ticket uuid) returns boolean
language sql stable security definer
set search_path = pg_catalog, app
as $$
  select coalesce((
    select t.status = 'OPEN'
       and t.centre_id = any (app.visible_centre_ids())
       and t.raised_by <> me.id
       and not exists (select 1 from app.ticket_event e
                       where e.ticket_id = t.id and e.action = 'APPROVE' and e.actor_id = me.id)
       and app.has_permission('ticket.approve', t.centre_id)
       and (t.assigned_user_id = me.id
            or (t.assigned_user_id is null
                and (l.approver_user_id = me.id
                     or (l.approver_role_id is not null
                         and t.centre_id = any (app.user_centre_ids(me.id, null, l.approver_role_id))))))
    from app.ticket t
    join app.ticket_level l on l.ticket_id = t.id and l.level = t.current_level
    cross join (select app.session_user_id() as id) me
    where t.id = p_ticket), false)
$$;

-- Rule 2: may p_user be made the forward or reassign target? Also refuses a user who already approved
-- this ticket, who could not act on it (DD-14) and would strand it.
create function app.ticket_may_receive(p_ticket uuid, p_user uuid) returns boolean
language sql stable security definer
set search_path = pg_catalog, app
as $$
  select coalesce((
    select t.status = 'OPEN'
       and t.centre_id = any (app.visible_centre_ids())
       and p_user <> app.session_user_id()
       and p_user <> t.raised_by
       and exists (select 1 from app.app_user u where u.id = p_user and u.status = 'ACTIVE')
       and not exists (select 1 from app.ticket_event e
                       where e.ticket_id = t.id and e.action = 'APPROVE' and e.actor_id = p_user)
       and t.centre_id = any (app.user_centre_ids(p_user, 'ticket.approve'))
    from app.ticket t
    where t.id = p_ticket), false)
$$;

-- ponytail: evaluates rule 2 per active user; a set query if the user count makes the picker slow
create function app.ticket_forward_candidates(p_ticket uuid) returns table (id uuid, display_name text)
language sql stable security definer
set search_path = pg_catalog, app
as $$
  select u.id, u.display_name from app.app_user u
  where u.status = 'ACTIVE' and app.ticket_may_receive(p_ticket, u.id)
  order by u.display_name, u.id
$$;

-- Rule 3: may the actor see this ticket?
create function app.ticket_may_view(p_ticket uuid) returns boolean
language sql stable security definer
set search_path = pg_catalog, app
as $$
  select coalesce((
    select t.centre_id = any (app.visible_centre_ids())
       and (app.has_permission('ticket.view', t.centre_id)
            or t.raised_by = me.id
            or exists (select 1 from app.ticket_level l
                       where l.ticket_id = t.id
                         and (l.approver_user_id = me.id
                              or (l.approver_role_id is not null
                                  and t.centre_id = any (app.user_centre_ids(me.id, null, l.approver_role_id)))))
            or exists (select 1 from app.ticket_event e where e.ticket_id = t.id and e.to_user_id = me.id)
            or exists (select 1 from app.ticket_type_viewer v
                       where v.type_id = t.type_id
                         and (v.user_id = me.id
                              or (v.role_id is not null
                                  and t.centre_id = any (app.user_centre_ids(me.id, null, v.role_id))))))
    from app.ticket t
    cross join (select app.session_user_id() as id) me
    where t.id = p_ticket), false)
$$;

-- Names for the list, detail and history: gems_app can read other users only with rbac.view.
create function app.ticket_people(p_ticket uuid) returns table (id uuid, display_name text)
language sql stable security definer
set search_path = pg_catalog, app
as $$
  select u.id, u.display_name from app.app_user u
  where app.ticket_may_view(p_ticket)
    and u.id in (
      select raised_by from app.ticket where id = p_ticket
      union select assigned_user_id from app.ticket where id = p_ticket
      union select approver_user_id from app.ticket_level where ticket_id = p_ticket
      union select actor_id from app.ticket_event where ticket_id = p_ticket
      union select to_user_id from app.ticket_event where ticket_id = p_ticket)
  order by u.display_name, u.id
$$;

-- Row lock on a type for raise and last-level approval, so a deactivation waits for them.
-- A direct "for share" would be filtered by the setup tables' UPDATE policy for everyone without
-- ticket.type.manage. Locks take a volatile function.
create function app.ticket_type_lock(p_type int) returns table (active boolean, handler_key text)
language sql volatile security definer
set search_path = pg_catalog, app
as $$
  select t.active, t.handler_key from app.ticket_type t where t.id = p_type for share
$$;

revoke all on function app.user_centre_ids(uuid, text, int), app.ticket_may_act(uuid),
  app.ticket_may_receive(uuid, uuid), app.ticket_forward_candidates(uuid), app.ticket_may_view(uuid),
  app.ticket_people(uuid), app.ticket_type_lock(int) from public;
grant execute on function app.ticket_may_act(uuid), app.ticket_may_receive(uuid, uuid),
  app.ticket_forward_candidates(uuid), app.ticket_may_view(uuid), app.ticket_people(uuid),
  app.ticket_type_lock(int) to gems_app;

-- ---------- Permissions ----------
insert into app.permission (key, description, sensitive) values
  ('ticket.raise', 'Raise tickets for a centre', false),
  ('ticket.view', 'View all tickets of a centre', false),
  ('ticket.approve', 'Approve, reject and forward tickets of a centre', false),
  ('ticket.document.view', 'Download documents attached to tickets of a centre', false),
  ('ticket.type.manage', 'Set up ticket types and reassign stranded tickets', true)
on conflict (key) do nothing;

-- ---------- Grants (deny by default) ----------
grant select, insert on app.ticket, app.ticket_level, app.ticket_event, app.ticket_upload, app.ticket_document to gems_app;
grant update on app.ticket to gems_app;
grant select, insert, update on app.ticket_number_series to gems_app;
grant select, insert, update, delete on app.ticket_category, app.ticket_type, app.ticket_type_level, app.ticket_type_viewer to gems_app;
grant usage on sequence app.ticket_category_id_seq, app.ticket_type_id_seq, app.ticket_type_viewer_id_seq,
  app.ticket_event_id_seq, app.ticket_document_id_seq to gems_app;
