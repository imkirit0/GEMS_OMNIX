-- Search rate limit (audit 06 §3, T5 bulk exfiltration and T17 heavy reports; T-SEC-015 search part).
-- One counted action per row, per user and bucket. The app role has no grant on the table: it can only call
-- app.rate_take(), which checks and records in one step for the session's own user.

-- Generated part (prisma migrate diff)
CREATE TABLE "app"."rate_hit" (
    "id" BIGSERIAL NOT NULL,
    "user_id" UUID NOT NULL,
    "bucket" TEXT NOT NULL,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_hit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "rate_hit_user_id_bucket_at_idx" ON "app"."rate_hit"("user_id", "bucket", "at");

-- ---------- Hand-written ----------

-- true and one hit recorded when the session's user is under p_max hits in the last p_minutes for p_bucket;
-- false (nothing recorded) otherwise, and for no session. Old hits of the same user and bucket are pruned here,
-- so the table stays small without a job.
-- ponytail: two concurrent calls can both pass at p_max - 1 (no lock); fine for a soft abuse limit, take an
-- advisory lock per (user, bucket) if it ever has to be exact.
create function app.rate_take(p_bucket text, p_max int, p_minutes int) returns boolean
language plpgsql volatile security definer
set search_path = pg_catalog, app
as $$
declare
  me uuid := app.session_user_id();
  n int;
begin
  if me is null then return false; end if;
  delete from app.rate_hit where user_id = me and bucket = p_bucket and at < now() - make_interval(mins => p_minutes);
  select count(*) into n from app.rate_hit where user_id = me and bucket = p_bucket;
  if n >= p_max then return false; end if;
  insert into app.rate_hit (user_id, bucket) values (me, p_bucket);
  return true;
end $$;

revoke all on function app.rate_take(text, int, int) from public;
grant execute on function app.rate_take(text, int, int) to gems_app;
