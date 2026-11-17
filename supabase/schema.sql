-- Pixelia pre-registration schema
-- Paste everything into Supabase SQL Editor and click Run. Safe to run again.

-- 1. Tables ------------------------------------------------------------------
create table if not exists public.preorders (
  id               bigint generated always as identity primary key,
  nickname         text not null,
  nickname_lower   text generated always as (lower(nickname)) stored,
  source           text not null,
  source_etc       text,
  referrer         text,
  referrer_lower   text generated always as (lower(referrer)) stored,
  via_ref          boolean not null default false,
  created_at       timestamptz not null default now(),
  is_invalid       boolean not null default false,
  reward_given     boolean not null default false,
  top_reward_given boolean not null default false,

  -- nickname: 3-16 chars, letters/digits/underscore/space, trimmed, no double spaces
  constraint nickname_format check (
    nickname ~ '^[A-Za-z0-9_ ]{3,16}$' and nickname = btrim(nickname) and position('  ' in nickname) = 0
  ),
  constraint source_value check (source in ('youtube', 'tiktok', 'discord', 'friend', 'other')),
  -- source_etc required only for 'other', 1-50 chars, no control chars
  constraint source_etc_rule check (
    (source = 'other') = (source_etc is not null)
    and (source_etc is null or (
      char_length(btrim(source_etc)) between 1 and 50 and source_etc !~ '[[:cntrl:]]'
    ))
  ),
  constraint referrer_format check (
    referrer is null or (
      referrer ~ '^[A-Za-z0-9_ ]{3,16}$' and referrer = btrim(referrer) and position('  ' in referrer) = 0
    )
  ),
  constraint referrer_not_self check (referrer is null or lower(referrer) <> lower(nickname)),
  constraint via_ref_needs_referrer check (not via_ref or referrer is not null)
);

create unique index if not exists preorders_nickname_lower_key on public.preorders (nickname_lower);
create index if not exists preorders_referrer_lower_idx on public.preorders (referrer_lower) where referrer_lower is not null;

create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 2. Admin check --------------------------------------------------------------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()));
$$;

-- 3. Privileges ---------------------------------------------------------------
revoke all on public.preorders from anon, authenticated, public;
revoke all on public.admins    from anon, authenticated, public;

-- anon may only insert these columns (cannot set id/created_at/is_invalid/reward flags)
grant insert (nickname, source, source_etc, referrer, via_ref) on public.preorders to anon, authenticated;
-- admins (checked by RLS below)
grant select, delete on public.preorders to authenticated;
grant update (is_invalid, reward_given, top_reward_given) on public.preorders to authenticated;

do $$
declare seq text := pg_get_serial_sequence('public.preorders', 'id');
begin
  execute format('grant usage on sequence %s to anon, authenticated', seq);
end $$;

-- 4. Row Level Security -------------------------------------------------------
alter table public.preorders enable row level security;
alter table public.admins    enable row level security;

drop policy if exists preorders_insert_public on public.preorders;
drop policy if exists preorders_select_admin  on public.preorders;
drop policy if exists preorders_update_admin  on public.preorders;
drop policy if exists preorders_delete_admin  on public.preorders;

create policy preorders_insert_public on public.preorders
  for insert to anon, authenticated
  with check (not is_invalid and not reward_given and not top_reward_given);

create policy preorders_select_admin on public.preorders
  for select to authenticated using ((select public.is_admin()));

create policy preorders_update_admin on public.preorders
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy preorders_delete_admin on public.preorders
  for delete to authenticated using ((select public.is_admin()));
-- admins table: no policies = nobody can read/write it through the API.

-- 5. Public RPC (no personal data) --------------------------------------------
-- Total valid count + top 10 promoters.
create or replace function public.preorder_stats() returns json
language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'total', (select count(*) from public.preorders where not is_invalid),
    'ranking', coalesce((
      select json_agg(r) from (
        select coalesce(max(u.nickname), min(p.referrer)) as nickname,
               count(*)::int as count
        from public.preorders p
        left join public.preorders u on u.nickname_lower = p.referrer_lower
        where not p.is_invalid
          and p.referrer_lower is not null
          and coalesce(u.is_invalid, false) = false
        group by p.referrer_lower
        order by count(*) desc, max(p.created_at) asc
        limit 10
      ) r
    ), '[]'::json)
  );
$$;

-- Position of a nickname (N-th registrant). NULL = not registered (nickname available).
create or replace function public.preorder_position(p_nickname text) returns integer
language sql stable security definer set search_path = '' as $$
  select (
    select count(*)::int from public.preorders q
    where q.id <= p.id and (not q.is_invalid or q.id = p.id)
  )
  from public.preorders p
  where p.nickname_lower = lower(btrim(p_nickname));
$$;

revoke all on function public.is_admin()                from public, anon, authenticated;
revoke all on function public.preorder_stats()          from public, anon, authenticated;
revoke all on function public.preorder_position(text)   from public, anon, authenticated;
grant execute on function public.is_admin()              to authenticated;
grant execute on function public.preorder_stats()        to anon, authenticated;
grant execute on function public.preorder_position(text) to anon, authenticated;

-- 6. Register an admin (run separately after creating the user in Authentication > Users)
-- insert into public.admins (user_id)
--   select id from auth.users where email = 'admin@example.com'
--   on conflict do nothing;

-- 7. Only when Turnstile is enabled (README step 4): block direct inserts,
--    so every registration must pass the Edge Function captcha check.
-- revoke insert on public.preorders from anon, authenticated;
-- To turn it back off:
-- grant insert (nickname, source, source_etc, referrer, via_ref) on public.preorders to anon, authenticated;
