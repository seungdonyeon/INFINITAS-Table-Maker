-- INFINITAS Table Maker (Supabase)
-- Apply in Supabase SQL Editor

create extension if not exists pgcrypto;

create table if not exists public.users (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  infinitas_id text not null unique,
  dj_name text not null,
  google_email text,
  icon_data_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_infinitas_id_format_chk check (
    infinitas_id ~ '^C-[0-9]{4}-[0-9]{4}-[0-9]{4}$'
    and infinitas_id <> 'C-0000-0000-0000'
  )
);

create table if not exists public.account_states (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  account_id text not null,
  tracker_rows jsonb not null default '[]'::jsonb,
  goals jsonb not null default '[]'::jsonb,
  history jsonb not null default '[]'::jsonb,
  last_progress jsonb not null default '{}'::jsonb,
  social_settings jsonb not null default '{}'::jsonb,
  update_reason text,
  updated_at timestamptz not null default now()
);

alter table public.account_states
  add column if not exists social_settings jsonb not null default '{}'::jsonb;

create table if not exists public.goal_shares (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  goals jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rivals (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  rival_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (owner_user_id, rival_user_id),
  constraint rivals_not_self_chk check (owner_user_id <> rival_user_id)
);

create table if not exists public.follow_requests (
  id uuid primary key default gen_random_uuid(),
  requester_user_id uuid not null references auth.users(id) on delete cascade,
  target_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending',
  message text,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint follow_requests_not_self_chk check (requester_user_id <> target_user_id),
  constraint follow_requests_status_chk check (status in ('pending', 'accepted', 'rejected', 'canceled'))
);

create table if not exists public.follows (
  follower_user_id uuid not null references auth.users(id) on delete cascade,
  following_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_user_id, following_user_id),
  constraint follows_not_self_chk check (follower_user_id <> following_user_id)
);

create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  receiver_user_id uuid not null references auth.users(id) on delete cascade,
  source text not null default 'song',
  song_title text,
  chart_type text,
  challenge_type text not null,
  status text not null default 'pending',
  parent_challenge_id uuid references public.challenges(id) on delete set null,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint challenges_not_self_chk check (sender_user_id <> receiver_user_id),
  constraint challenges_type_chk check (challenge_type in ('lamp', 'score', 'both')),
  constraint challenges_status_chk check (status in ('pending', 'accepted', 'rejected', 'completed', 'returned')),
  constraint challenges_source_chk check (source in ('song', 'history'))
);

alter table public.users enable row level security;
alter table public.account_states enable row level security;
alter table public.goal_shares enable row level security;
alter table public.rivals enable row level security;
alter table public.follow_requests enable row level security;
alter table public.follows enable row level security;
alter table public.challenges enable row level security;

drop policy if exists users_select_own on public.users;
create policy users_select_own on public.users
  for select using (auth.uid() = auth_user_id);
drop policy if exists users_insert_own on public.users;
create policy users_insert_own on public.users
  for insert with check (auth.uid() = auth_user_id);
drop policy if exists users_update_own on public.users;
create policy users_update_own on public.users
  for update using (auth.uid() = auth_user_id);

drop policy if exists states_select_own on public.account_states;
create policy states_select_own on public.account_states
  for select using (auth.uid() = auth_user_id);
drop policy if exists states_insert_own on public.account_states;
create policy states_insert_own on public.account_states
  for insert with check (auth.uid() = auth_user_id);
drop policy if exists states_update_own on public.account_states;
create policy states_update_own on public.account_states
  for update using (auth.uid() = auth_user_id);

drop policy if exists goal_shares_owner_all on public.goal_shares;
create policy goal_shares_owner_all on public.goal_shares
  for all using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);

drop policy if exists rivals_owner_all on public.rivals;
create policy rivals_owner_all on public.rivals
  for all using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);

drop policy if exists rivals_read_reverse on public.rivals;
create policy rivals_read_reverse on public.rivals
  for select using (auth.uid() = rival_user_id);

drop policy if exists follow_requests_select_participants on public.follow_requests;
create policy follow_requests_select_participants on public.follow_requests
  for select using (auth.uid() in (requester_user_id, target_user_id));
drop policy if exists follow_requests_insert_requester on public.follow_requests;
create policy follow_requests_insert_requester on public.follow_requests
  for insert with check (auth.uid() = requester_user_id);
drop policy if exists follow_requests_update_participants on public.follow_requests;
create policy follow_requests_update_participants on public.follow_requests
  for update using (auth.uid() in (requester_user_id, target_user_id))
  with check (auth.uid() in (requester_user_id, target_user_id));
create unique index if not exists follow_requests_pending_unique
  on public.follow_requests (requester_user_id, target_user_id)
  where status = 'pending';

drop policy if exists follows_select_participants on public.follows;
create policy follows_select_participants on public.follows
  for select using (auth.uid() in (follower_user_id, following_user_id));
drop policy if exists follows_insert_follower on public.follows;
create policy follows_insert_follower on public.follows
  for insert with check (auth.uid() = follower_user_id);
drop policy if exists follows_delete_follower on public.follows;
create policy follows_delete_follower on public.follows
  for delete using (auth.uid() = follower_user_id);

drop policy if exists challenges_select_participants on public.challenges;
create policy challenges_select_participants on public.challenges
  for select using (auth.uid() in (sender_user_id, receiver_user_id));
drop policy if exists challenges_insert_sender on public.challenges;
create policy challenges_insert_sender on public.challenges
  for insert with check (auth.uid() = sender_user_id);
drop policy if exists challenges_update_receiver on public.challenges;
create policy challenges_update_receiver on public.challenges
  for update using (auth.uid() = receiver_user_id) with check (auth.uid() = receiver_user_id);

create or replace function public.get_public_profile_by_infinitas_id(p_infinitas_id text)
returns table (
  auth_user_id uuid,
  infinitas_id text,
  dj_name text,
  discoverability text,
  follow_policy text,
  rival_policy text,
  share_data_scope jsonb
)
language sql
security definer
set search_path = public
as $$
  select
    u.auth_user_id,
    u.infinitas_id,
    u.dj_name,
    coalesce(a.social_settings->>'discoverability', 'searchable') as discoverability,
    coalesce(a.social_settings->>'followPolicy', 'manual') as follow_policy,
    coalesce(a.social_settings->>'rivalPolicy', 'followers') as rival_policy,
    coalesce(a.social_settings->'shareDataScope', '["graphs","goals"]'::jsonb) as share_data_scope
  from public.users u
  left join public.account_states a on a.auth_user_id = u.auth_user_id
  where u.infinitas_id = p_infinitas_id
    and coalesce(a.social_settings->>'discoverability', 'searchable') = 'searchable';
$$;

revoke all on function public.get_public_profile_by_infinitas_id(text) from public;
grant execute on function public.get_public_profile_by_infinitas_id(text) to authenticated;

create or replace function public.get_song_social_context(
  p_title text,
  p_chart_type text
)
returns table (
  kind text,
  peer_user_id uuid,
  dj_name text,
  infinitas_id text,
  lamp text,
  ex_score int,
  can_challenge boolean
)
language sql
security definer
set search_path = public
as $$
  with my_row as (
    select r
    from public.account_states s
    cross join lateral jsonb_array_elements(coalesce(s.tracker_rows, '[]'::jsonb)) r
    where s.auth_user_id = auth.uid()
      and lower(trim(coalesce(r->>'title', ''))) = lower(trim(coalesce(p_title, '')))
    limit 1
  ),
  my_stats as (
    select
      case
        when p_chart_type = 'H' then coalesce((select r->>'SPH Lamp' from my_row), 'NP')
        when p_chart_type = 'L' then coalesce((select r->>'SPL Lamp' from my_row), 'NP')
        else coalesce((select r->>'SPA Lamp' from my_row), 'NP')
      end as lamp,
      case
        when p_chart_type = 'H' then coalesce((select (r->>'SPH EX Score')::int from my_row), 0)
        when p_chart_type = 'L' then coalesce((select (r->>'SPL EX Score')::int from my_row), 0)
        else coalesce((select (r->>'SPA EX Score')::int from my_row), 0)
      end as ex_score
  ),
  peers as (
    select 'follow'::text as kind,
           case when f.follower_user_id = auth.uid() then f.following_user_id else f.follower_user_id end as peer_id
    from public.follows f
    where auth.uid() in (f.follower_user_id, f.following_user_id)
    union all
    select 'rival'::text as kind,
           case when r.owner_user_id = auth.uid() then r.rival_user_id else r.owner_user_id end as peer_id
    from public.rivals r
    where auth.uid() in (r.owner_user_id, r.rival_user_id)
  ),
  peer_rows as (
    select
      p.kind,
      p.peer_id,
      u.dj_name,
      u.infinitas_id,
      a.social_settings,
      tr.r as row
    from peers p
    join public.users u on u.auth_user_id = p.peer_id
    left join public.account_states a on a.auth_user_id = p.peer_id
    left join lateral (
      select r
      from jsonb_array_elements(coalesce(a.tracker_rows, '[]'::jsonb)) r
      where lower(trim(coalesce(r->>'title', ''))) = lower(trim(coalesce(p_title, '')))
      limit 1
    ) tr on true
  )
  select
    pr.kind,
    pr.peer_id as peer_user_id,
    pr.dj_name,
    pr.infinitas_id,
    case
      when p_chart_type = 'H' then coalesce(pr.row->>'SPH Lamp', 'NP')
      when p_chart_type = 'L' then coalesce(pr.row->>'SPL Lamp', 'NP')
      else coalesce(pr.row->>'SPA Lamp', 'NP')
    end as lamp,
    case
      when p_chart_type = 'H' then coalesce((pr.row->>'SPH EX Score')::int, 0)
      when p_chart_type = 'L' then coalesce((pr.row->>'SPL EX Score')::int, 0)
      else coalesce((pr.row->>'SPA EX Score')::int, 0)
    end as ex_score,
    (
      pr.kind = 'rival'
      and (
        (case (select lamp from my_stats)
          when 'NP' then 0 when 'F' then 1 when 'EASY' then 2 when 'NORMAL' then 3 when 'HC' then 4 when 'EX' then 5 when 'FC' then 6 else 0 end)
        >
        (case
          when p_chart_type = 'H' then case coalesce(pr.row->>'SPH Lamp', 'NP') when 'NP' then 0 when 'F' then 1 when 'EASY' then 2 when 'NORMAL' then 3 when 'HC' then 4 when 'EX' then 5 when 'FC' then 6 else 0 end
          when p_chart_type = 'L' then case coalesce(pr.row->>'SPL Lamp', 'NP') when 'NP' then 0 when 'F' then 1 when 'EASY' then 2 when 'NORMAL' then 3 when 'HC' then 4 when 'EX' then 5 when 'FC' then 6 else 0 end
          else case coalesce(pr.row->>'SPA Lamp', 'NP') when 'NP' then 0 when 'F' then 1 when 'EASY' then 2 when 'NORMAL' then 3 when 'HC' then 4 when 'EX' then 5 when 'FC' then 6 else 0 end
        end)
        or
        ((select ex_score from my_stats) >
          case
            when p_chart_type = 'H' then coalesce((pr.row->>'SPH EX Score')::int, 0)
            when p_chart_type = 'L' then coalesce((pr.row->>'SPL EX Score')::int, 0)
            else coalesce((pr.row->>'SPA EX Score')::int, 0)
          end
        )
      )
    ) as can_challenge
  from peer_rows pr
  where
    pr.kind = 'rival'
    or coalesce(pr.social_settings->'shareDataScope', '[]'::jsonb) ? 'all';
$$;

revoke all on function public.get_song_social_context(text, text) from public;
grant execute on function public.get_song_social_context(text, text) to authenticated;

create or replace function public.get_rival_overview_context()
returns table (
  peer_user_id uuid,
  dj_name text,
  infinitas_id text
)
language sql
security definer
set search_path = public
as $$
  select
    case when r.owner_user_id = auth.uid() then r.rival_user_id else r.owner_user_id end as peer_user_id,
    u.dj_name,
    u.infinitas_id
  from public.rivals r
  join public.users u on u.auth_user_id = case when r.owner_user_id = auth.uid() then r.rival_user_id else r.owner_user_id end
  where auth.uid() in (r.owner_user_id, r.rival_user_id);
$$;

revoke all on function public.get_rival_overview_context() from public;
grant execute on function public.get_rival_overview_context() to authenticated;

create or replace function public.send_follow_request(p_target_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_follow_policy text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if p_target_user_id = auth.uid() then
    raise exception 'cannot_follow_self';
  end if;
  if (select count(*) from public.follows f where f.follower_user_id = auth.uid()) >= 8 then
    raise exception 'follow_limit_exceeded';
  end if;
  if exists (
    select 1 from public.follows f
    where f.follower_user_id = auth.uid()
      and f.following_user_id = p_target_user_id
  ) then
    return 'already_following';
  end if;

  select coalesce(a.social_settings->>'followPolicy', 'manual')
  into v_follow_policy
  from public.account_states a
  where a.auth_user_id = p_target_user_id;

  if coalesce(v_follow_policy, 'manual') = 'disabled' then
    raise exception 'target_follow_disabled';
  end if;

  if coalesce(v_follow_policy, 'manual') = 'auto' then
    insert into public.follows (follower_user_id, following_user_id)
    values (auth.uid(), p_target_user_id)
    on conflict do nothing;
    return 'auto_accepted';
  end if;

  insert into public.follow_requests (
    requester_user_id,
    target_user_id,
    status
  ) values (
    auth.uid(),
    p_target_user_id,
    'pending'
  );
  return 'requested';
end;
$$;

revoke all on function public.send_follow_request(uuid) from public;
grant execute on function public.send_follow_request(uuid) to authenticated;

create or replace function public.respond_follow_request(
  p_request_id uuid,
  p_accept boolean
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.follow_requests;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_request
  from public.follow_requests
  where id = p_request_id
    and target_user_id = auth.uid()
    and status = 'pending';
  if not found then
    raise exception 'request_not_found';
  end if;
  if p_accept then
    insert into public.follows (follower_user_id, following_user_id)
    values (v_request.requester_user_id, v_request.target_user_id)
    on conflict do nothing;
    update public.follow_requests
      set status = 'accepted', responded_at = now()
    where id = p_request_id;
    return 'accepted';
  end if;
  update public.follow_requests
    set status = 'rejected', responded_at = now()
  where id = p_request_id;
  return 'rejected';
end;
$$;

revoke all on function public.respond_follow_request(uuid, boolean) from public;
grant execute on function public.respond_follow_request(uuid, boolean) to authenticated;

create or replace function public.add_rival_user(p_target_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rival_policy text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if p_target_user_id = auth.uid() then
    raise exception 'cannot_rival_self';
  end if;
  if (select count(*) from public.rivals r where r.owner_user_id = auth.uid()) >= 4 then
    raise exception 'rival_limit_exceeded';
  end if;

  select coalesce(a.social_settings->>'rivalPolicy', 'followers')
  into v_rival_policy
  from public.account_states a
  where a.auth_user_id = p_target_user_id;

  if coalesce(v_rival_policy, 'followers') = 'disabled' then
    raise exception 'target_rival_disabled';
  end if;
  if coalesce(v_rival_policy, 'followers') = 'followers'
     and not exists (
       select 1 from public.follows f
       where (f.follower_user_id = auth.uid() and f.following_user_id = p_target_user_id)
          or (f.follower_user_id = p_target_user_id and f.following_user_id = auth.uid())
     )
  then
    raise exception 'target_rival_followers_only';
  end if;

  insert into public.rivals (owner_user_id, rival_user_id)
  values (auth.uid(), p_target_user_id)
  on conflict do nothing;
  return 'added';
end;
$$;

revoke all on function public.add_rival_user(uuid) from public;
grant execute on function public.add_rival_user(uuid) to authenticated;

create or replace function public.get_social_overview()
returns table (
  relation_type text,
  request_id uuid,
  peer_user_id uuid,
  dj_name text,
  infinitas_id text,
  status text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    case when fr.target_user_id = auth.uid() then 'request_in' else 'request_out' end as relation_type,
    fr.id as request_id,
    case when fr.target_user_id = auth.uid() then fr.requester_user_id else fr.target_user_id end as peer_user_id,
    u.dj_name,
    u.infinitas_id,
    fr.status,
    fr.created_at
  from public.follow_requests fr
  join public.users u on u.auth_user_id = case when fr.target_user_id = auth.uid() then fr.requester_user_id else fr.target_user_id end
  where auth.uid() in (fr.requester_user_id, fr.target_user_id)
  union all
  select
    'follow'::text,
    null::uuid,
    case when f.follower_user_id = auth.uid() then f.following_user_id else f.follower_user_id end as peer_user_id,
    u.dj_name,
    u.infinitas_id,
    'accepted'::text,
    f.created_at
  from public.follows f
  join public.users u on u.auth_user_id = case when f.follower_user_id = auth.uid() then f.following_user_id else f.follower_user_id end
  where auth.uid() in (f.follower_user_id, f.following_user_id)
  union all
  select
    'rival'::text,
    null::uuid,
    case when r.owner_user_id = auth.uid() then r.rival_user_id else r.owner_user_id end as peer_user_id,
    u.dj_name,
    u.infinitas_id,
    'added'::text,
    r.created_at
  from public.rivals r
  join public.users u on u.auth_user_id = case when r.owner_user_id = auth.uid() then r.rival_user_id else r.owner_user_id end
  where auth.uid() in (r.owner_user_id, r.rival_user_id);
$$;

revoke all on function public.get_social_overview() from public;
grant execute on function public.get_social_overview() to authenticated;

create or replace function public.send_challenge(
  p_receiver_user_id uuid,
  p_source text,
  p_song_title text,
  p_chart_type text,
  p_challenge_type text,
  p_parent_challenge_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if auth.uid() = p_receiver_user_id then
    raise exception 'cannot_challenge_self';
  end if;
  if p_challenge_type not in ('lamp', 'score', 'both') then
    raise exception 'invalid_challenge_type';
  end if;
  if p_source not in ('song', 'history') then
    raise exception 'invalid_challenge_source';
  end if;
  if not exists (
    select 1
    from public.rivals r
    where (r.owner_user_id = auth.uid() and r.rival_user_id = p_receiver_user_id)
       or (r.owner_user_id = p_receiver_user_id and r.rival_user_id = auth.uid())
  ) then
    raise exception 'receiver_not_rival';
  end if;

  insert into public.challenges (
    sender_user_id,
    receiver_user_id,
    source,
    song_title,
    chart_type,
    challenge_type,
    status,
    parent_challenge_id
  )
  values (
    auth.uid(),
    p_receiver_user_id,
    p_source,
    p_song_title,
    p_chart_type,
    p_challenge_type,
    'pending',
    p_parent_challenge_id
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.send_challenge(uuid, text, text, text, text, uuid) from public;
grant execute on function public.send_challenge(uuid, text, text, text, text, uuid) to authenticated;

create or replace function public.limit_follow_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (
    select count(*)
    from public.follows f
    where f.follower_user_id = new.follower_user_id
  ) >= 8 then
    raise exception 'follow_limit_exceeded';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_limit_follow_insert on public.follows;
create trigger trg_limit_follow_insert
before insert on public.follows
for each row execute procedure public.limit_follow_insert();

create or replace function public.limit_rival_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (
    select count(*)
    from public.rivals r
    where r.owner_user_id = new.owner_user_id
  ) >= 4 then
    raise exception 'rival_limit_exceeded';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_limit_rival_insert on public.rivals;
create trigger trg_limit_rival_insert
before insert on public.rivals
for each row execute procedure public.limit_rival_insert();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_users_updated_at on public.users;
create trigger trg_users_updated_at
before update on public.users
for each row execute procedure public.set_updated_at();

drop trigger if exists trg_account_states_updated_at on public.account_states;
create trigger trg_account_states_updated_at
before update on public.account_states
for each row execute procedure public.set_updated_at();

drop trigger if exists trg_goal_shares_updated_at on public.goal_shares;
create trigger trg_goal_shares_updated_at
before update on public.goal_shares
for each row execute procedure public.set_updated_at();
