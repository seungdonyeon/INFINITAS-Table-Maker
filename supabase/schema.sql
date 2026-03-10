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

create or replace function public.get_public_profile_by_dj_name(p_dj_name text)
returns table (
  auth_user_id uuid,
  infinitas_id text,
  dj_name text,
  google_email text,
  icon_data_url text,
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
    u.google_email,
    u.icon_data_url,
    coalesce(a.social_settings->'shareDataScope', '["graphs","goals"]'::jsonb) as share_data_scope
  from public.users u
  left join public.account_states a on a.auth_user_id = u.auth_user_id
  where lower(trim(coalesce(u.dj_name, ''))) = lower(trim(coalesce(p_dj_name, '')))
    and coalesce(a.social_settings->>'discoverByDjName', 'true') = 'true'
    and coalesce(a.social_settings->>'discoverability', 'searchable') = 'searchable'
  limit 20;
$$;

revoke all on function public.get_public_profile_by_dj_name(text) from public;
grant execute on function public.get_public_profile_by_dj_name(text) to authenticated;

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
    false as can_challenge
  from peer_rows pr
  where pr.kind = 'follow';
$$;

revoke all on function public.get_song_social_context(text, text) from public;
grant execute on function public.get_song_social_context(text, text) to authenticated;

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

create or replace function public.get_social_overview()
returns table (
  relation_type text,
  request_id uuid,
  peer_user_id uuid,
  dj_name text,
  infinitas_id text,
  direction text,
  icon_data_url text,
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
    case when fr.target_user_id = auth.uid() then 'incoming' else 'outgoing' end as direction,
    coalesce(u.icon_data_url, '') as icon_data_url,
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
    case when f.follower_user_id = auth.uid() then 'following' else 'follower' end as direction,
    coalesce(u.icon_data_url, '') as icon_data_url,
    'accepted'::text,
    f.created_at
  from public.follows f
  join public.users u on u.auth_user_id = case when f.follower_user_id = auth.uid() then f.following_user_id else f.follower_user_id end
  where auth.uid() in (f.follower_user_id, f.following_user_id);
$$;

revoke all on function public.get_social_overview() from public;
grant execute on function public.get_social_overview() to authenticated;

create or replace function public.get_follow_lists()
returns table (
  direction text,
  peer_user_id uuid,
  dj_name text,
  infinitas_id text,
  icon_data_url text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    case when f.follower_user_id = auth.uid() then 'following' else 'follower' end as direction,
    case when f.follower_user_id = auth.uid() then f.following_user_id else f.follower_user_id end as peer_user_id,
    u.dj_name,
    u.infinitas_id,
    coalesce(u.icon_data_url, '') as icon_data_url,
    f.created_at
  from public.follows f
  join public.users u on u.auth_user_id = case when f.follower_user_id = auth.uid() then f.following_user_id else f.follower_user_id end
  where auth.uid() in (f.follower_user_id, f.following_user_id)
  order by f.created_at desc;
$$;

revoke all on function public.get_follow_lists() from public;
grant execute on function public.get_follow_lists() to authenticated;

create or replace function public.get_follow_tracker_rows(p_peer_user_id uuid)
returns table (
  peer_user_id uuid,
  dj_name text,
  infinitas_id text,
  tracker_rows jsonb
)
language sql
security definer
set search_path = public
as $$
  select
    u.auth_user_id as peer_user_id,
    u.dj_name,
    u.infinitas_id,
    coalesce(a.tracker_rows, '[]'::jsonb) as tracker_rows
  from public.users u
  left join public.account_states a on a.auth_user_id = u.auth_user_id
  where u.auth_user_id = p_peer_user_id
    and exists (
      select 1
      from public.follows f
      where (f.follower_user_id = auth.uid() and f.following_user_id = p_peer_user_id)
         or (f.following_user_id = auth.uid() and f.follower_user_id = p_peer_user_id)
    );
$$;

revoke all on function public.get_follow_tracker_rows(uuid) from public;
grant execute on function public.get_follow_tracker_rows(uuid) to authenticated;

create or replace function public.get_follow_history_detail(
  p_peer_user_id uuid,
  p_history_id text
)
returns table (
  peer_user_id uuid,
  dj_name text,
  infinitas_id text,
  history jsonb,
  prev_history jsonb
)
language sql
security definer
set search_path = public
as $$
  with peer as (
    select
      u.auth_user_id as peer_user_id,
      u.dj_name,
      u.infinitas_id,
      coalesce(a.history, '[]'::jsonb) as history_arr
    from public.users u
    left join public.account_states a on a.auth_user_id = u.auth_user_id
    where u.auth_user_id = p_peer_user_id
      and exists (
        select 1
        from public.follows f
        where (f.follower_user_id = auth.uid() and f.following_user_id = p_peer_user_id)
           or (f.following_user_id = auth.uid() and f.follower_user_id = p_peer_user_id)
      )
  ),
  target as (
    select
      (h.ord - 1)::int as idx,
      h.item as history
    from peer p
    cross join lateral jsonb_array_elements(p.history_arr) with ordinality as h(item, ord)
    where coalesce(h.item->>'id', '') = coalesce(p_history_id, '')
    order by h.ord desc
    limit 1
  )
  select
    p.peer_user_id,
    p.dj_name,
    p.infinitas_id,
    t.history,
    case when t.idx > 0 then p.history_arr -> (t.idx - 1) else null end as prev_history
  from peer p
  join target t on true;
$$;

revoke all on function public.get_follow_history_detail(uuid, text) from public;
grant execute on function public.get_follow_history_detail(uuid, text) to authenticated;

create or replace function public.purge_my_social_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.goal_transfers
  where sender_user_id = auth.uid()
     or receiver_user_id = auth.uid();

  delete from public.social_feed_events
  where owner_user_id = auth.uid()
     or actor_user_id = auth.uid();

  delete from public.follow_requests
  where requester_user_id = auth.uid()
     or target_user_id = auth.uid();

  delete from public.follows
  where follower_user_id = auth.uid()
     or following_user_id = auth.uid();

  delete from public.goal_shares
  where owner_user_id = auth.uid()
     or target_user_id = auth.uid();

  delete from public.account_states where auth_user_id = auth.uid();
  delete from public.users where auth_user_id = auth.uid();
end;
$$;

revoke all on function public.purge_my_social_data() from public;
grant execute on function public.purge_my_social_data() to authenticated;

create or replace function public.send_goal_bundle_to_user(
  p_target_user_id uuid,
  p_goals jsonb,
  p_sender_dj_name text default '',
  p_sender_infinitas_id text default ''
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_share_scope jsonb;
  v_sender_goal_transfer_enabled boolean := true;
  v_target_goal_transfer_enabled boolean := true;
  v_count int := 0;
  v_norm_goals jsonb := '[]'::jsonb;
  v_transfer_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if p_target_user_id is null then
    raise exception 'invalid_target';
  end if;
  if auth.uid() = p_target_user_id then
    raise exception 'cannot_send_to_self';
  end if;
  if not exists (
    select 1 from public.follows f
    where f.follower_user_id = auth.uid()
      and f.following_user_id = p_target_user_id
  ) or not exists (
    select 1 from public.follows f
    where f.follower_user_id = p_target_user_id
      and f.following_user_id = auth.uid()
  ) then
    raise exception 'mutual_follow_required';
  end if;

  select coalesce((a.social_settings->>'goalTransferEnabled')::boolean, true)
  into v_sender_goal_transfer_enabled
  from public.account_states a
  where a.auth_user_id = auth.uid();

  if coalesce(v_sender_goal_transfer_enabled, true) is not true then
    raise exception 'sender_goal_transfer_disabled';
  end if;

  select coalesce(a.social_settings->'shareDataScope', '[]'::jsonb)
  into v_share_scope
  from public.account_states a
  where a.auth_user_id = p_target_user_id;

  if not (
    coalesce(v_share_scope, '[]'::jsonb) ? 'all'
    or coalesce(v_share_scope, '[]'::jsonb) ? 'goals'
  ) then
    raise exception 'target_goal_share_disabled';
  end if;

  select coalesce((a.social_settings->>'goalTransferEnabled')::boolean, true)
  into v_target_goal_transfer_enabled
  from public.account_states a
  where a.auth_user_id = p_target_user_id;

  if coalesce(v_target_goal_transfer_enabled, true) is not true then
    raise exception 'target_goal_transfer_disabled';
  end if;

  select coalesce(jsonb_agg(g), '[]'::jsonb)
  into v_norm_goals
  from jsonb_array_elements(coalesce(p_goals, '[]'::jsonb)) g
  where coalesce(g->>'title', '') <> '';

  v_count := jsonb_array_length(coalesce(v_norm_goals, '[]'::jsonb));
  if v_count <= 0 then
    return 0;
  end if;

  insert into public.goal_transfers (
    sender_user_id,
    receiver_user_id,
    goals,
    sender_dj_name,
    sender_infinitas_id,
    status
  ) values (
    auth.uid(),
    p_target_user_id,
    v_norm_goals,
    nullif(trim(p_sender_dj_name), ''),
    nullif(trim(p_sender_infinitas_id), ''),
    'pending'
  )
  on conflict (sender_user_id, receiver_user_id) where (status = 'pending')
  do update set
    goals = excluded.goals,
    sender_dj_name = excluded.sender_dj_name,
    sender_infinitas_id = excluded.sender_infinitas_id,
    created_at = now(),
    responded_at = null,
    status = 'pending'
  returning id into v_transfer_id;

  perform public.create_social_feed_event(
    p_target_user_id,
    auth.uid(),
    'goal_transfer_received',
    jsonb_build_object(
      'transfer_id', v_transfer_id::text,
      'goal_count', v_count
    ),
    'goal_transfers',
    v_transfer_id
  );

  return v_count;
end;
$$;

revoke all on function public.send_goal_bundle_to_user(uuid, jsonb, text, text) from public;
grant execute on function public.send_goal_bundle_to_user(uuid, jsonb, text, text) to authenticated;

create or replace function public.respond_goal_transfer(
  p_transfer_id uuid,
  p_accept boolean
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transfer public.goal_transfers;
  v_tagged_goals jsonb := '[]'::jsonb;
  v_count int := 0;
  v_source text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_transfer
  from public.goal_transfers
  where id = p_transfer_id
    and receiver_user_id = auth.uid()
    and status = 'pending';

  if not found then
    raise exception 'goal_transfer_not_found';
  end if;

  if not p_accept then
    update public.goal_transfers
      set status = 'rejected', responded_at = now()
    where id = p_transfer_id;
    return 'rejected';
  end if;

  v_source := coalesce(nullif(trim(v_transfer.sender_dj_name), ''), '팔로우 목표 전송');

  select coalesce(jsonb_agg(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(g, '{id}', to_jsonb(gen_random_uuid()::text), true),
          '{source}',
          to_jsonb(v_source || case when nullif(trim(v_transfer.sender_infinitas_id), '') is null then '' else ' (' || trim(v_transfer.sender_infinitas_id) || ')' end),
          true
        ),
        '{sender_user_id}',
        to_jsonb(v_transfer.sender_user_id::text),
        true
      ),
      '{transfer_id}',
      to_jsonb(v_transfer.id::text),
      true
    )
  ), '[]'::jsonb)
  into v_tagged_goals
  from jsonb_array_elements(coalesce(v_transfer.goals, '[]'::jsonb)) g
  where coalesce(g->>'title', '') <> '';

  v_count := jsonb_array_length(coalesce(v_tagged_goals, '[]'::jsonb));

  insert into public.account_states (auth_user_id, account_id, goals, social_settings, updated_at, update_reason)
  values (auth.uid(), gen_random_uuid()::text, v_tagged_goals, '{}'::jsonb, now(), 'goal-transfer-accepted')
  on conflict (auth_user_id)
  do update set
    goals = coalesce(public.account_states.goals, '[]'::jsonb) || v_tagged_goals,
    updated_at = now(),
    update_reason = 'goal-transfer-accepted';

  update public.goal_transfers
    set status = 'accepted', responded_at = now()
  where id = p_transfer_id;

  perform public.create_social_feed_event(
    v_transfer.sender_user_id,
    auth.uid(),
    'goal_transfer_accepted',
    jsonb_build_object(
      'transfer_id', v_transfer.id::text,
      'goal_count', v_count
    ),
    'goal_transfers',
    v_transfer.id
  );

  return 'accepted';
end;
$$;

revoke all on function public.respond_goal_transfer(uuid, boolean) from public;
grant execute on function public.respond_goal_transfer(uuid, boolean) to authenticated;

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

create table if not exists public.social_feed_events (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  ref_table text,
  ref_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  dismissed_at timestamptz
);

create index if not exists social_feed_events_owner_created_idx
  on public.social_feed_events (owner_user_id, created_at desc);

create table if not exists public.goal_transfers (
  id uuid primary key default gen_random_uuid(),
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  receiver_user_id uuid not null references auth.users(id) on delete cascade,
  goals jsonb not null default '[]'::jsonb,
  sender_dj_name text,
  sender_infinitas_id text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint goal_transfers_not_self_chk check (sender_user_id <> receiver_user_id),
  constraint goal_transfers_status_chk check (status in ('pending', 'accepted', 'rejected', 'canceled'))
);

create unique index if not exists goal_transfers_pending_unique
  on public.goal_transfers (sender_user_id, receiver_user_id)
  where status = 'pending';

alter table public.social_feed_events enable row level security;
alter table public.goal_transfers enable row level security;

drop policy if exists social_feed_events_select_owner on public.social_feed_events;
create policy social_feed_events_select_owner on public.social_feed_events
  for select using (auth.uid() = owner_user_id);

drop policy if exists social_feed_events_update_owner on public.social_feed_events;
create policy social_feed_events_update_owner on public.social_feed_events
  for update using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);

drop policy if exists goal_transfers_select_participants on public.goal_transfers;
create policy goal_transfers_select_participants on public.goal_transfers
  for select using (auth.uid() in (sender_user_id, receiver_user_id));

drop policy if exists goal_transfers_insert_sender on public.goal_transfers;
create policy goal_transfers_insert_sender on public.goal_transfers
  for insert with check (auth.uid() = sender_user_id);

drop policy if exists goal_transfers_update_receiver_sender on public.goal_transfers;
create policy goal_transfers_update_receiver_sender on public.goal_transfers
  for update using (auth.uid() in (sender_user_id, receiver_user_id))
  with check (auth.uid() in (sender_user_id, receiver_user_id));

create or replace function public.create_social_feed_event(
  p_owner_user_id uuid,
  p_actor_user_id uuid,
  p_event_type text,
  p_payload jsonb default '{}'::jsonb,
  p_ref_table text default null,
  p_ref_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.social_feed_events (
    owner_user_id,
    actor_user_id,
    event_type,
    payload,
    ref_table,
    ref_id
  )
  values (
    p_owner_user_id,
    p_actor_user_id,
    p_event_type,
    coalesce(p_payload, '{}'::jsonb),
    p_ref_table,
    p_ref_id
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.create_social_feed_event(uuid, uuid, text, jsonb, text, uuid) from public;
grant execute on function public.create_social_feed_event(uuid, uuid, text, jsonb, text, uuid) to authenticated;

create or replace function public.feed_follow_request_insert_trigger()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'pending' then
    perform public.create_social_feed_event(
      new.target_user_id,
      new.requester_user_id,
      'follow_request_received',
      jsonb_build_object('request_id', new.id::text),
      'follow_requests',
      new.id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_feed_follow_request_insert on public.follow_requests;
create trigger trg_feed_follow_request_insert
after insert on public.follow_requests
for each row execute procedure public.feed_follow_request_insert_trigger();

create or replace function public.feed_follow_request_update_trigger()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status <> 'accepted' and new.status = 'accepted' then
    perform public.create_social_feed_event(
      new.requester_user_id,
      new.target_user_id,
      'follow_request_accepted',
      jsonb_build_object('request_id', new.id::text),
      'follow_requests',
      new.id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_feed_follow_request_update on public.follow_requests;
create trigger trg_feed_follow_request_update
after update on public.follow_requests
for each row execute procedure public.feed_follow_request_update_trigger();

create or replace function public.feed_follows_delete_trigger()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform public.create_social_feed_event(
    old.following_user_id,
    old.follower_user_id,
    'follower_unfollowed',
    '{}'::jsonb,
    'follows',
    null
  );
  return old;
end;
$$;

drop trigger if exists trg_feed_follows_delete on public.follows;
create trigger trg_feed_follows_delete
after delete on public.follows
for each row execute procedure public.feed_follows_delete_trigger();

create or replace function public.feed_history_update_trigger()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_old_count int;
  v_new_count int;
  v_last jsonb;
  v_follower uuid;
begin
  v_old_count := coalesce(jsonb_array_length(coalesce(old.history, '[]'::jsonb)), 0);
  v_new_count := coalesce(jsonb_array_length(coalesce(new.history, '[]'::jsonb)), 0);
  if v_new_count <= v_old_count then
    return new;
  end if;
  v_last := coalesce(new.history -> (v_new_count - 1), '{}'::jsonb);
  for v_follower in
    select f.follower_user_id
    from public.follows f
    where f.following_user_id = new.auth_user_id
  loop
    perform public.create_social_feed_event(
      v_follower,
      new.auth_user_id,
      'follow_history_updated',
      jsonb_build_object(
        'history_id', coalesce(v_last->>'id', ''),
        'summary', coalesce(v_last->>'summary', '')
      ),
      'account_states',
      null
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_feed_history_update on public.account_states;
create trigger trg_feed_history_update
after update on public.account_states
for each row execute procedure public.feed_history_update_trigger();

create or replace function public.feed_goal_update_trigger()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_rec record;
begin
  if coalesce(new.update_reason, '') like 'goal-transfer%' then
    return new;
  end if;
  if coalesce(new.goals, '[]'::jsonb) = coalesce(old.goals, '[]'::jsonb) then
    return new;
  end if;
  for v_rec in
    with old_goals as (
      select g->>'id' as goal_id, g as goal
      from jsonb_array_elements(coalesce(old.goals, '[]'::jsonb)) g
    ),
    new_goals as (
      select
        g->>'id' as goal_id,
        g as goal,
        nullif(g->>'sender_user_id', '')::uuid as sender_user_id
      from jsonb_array_elements(coalesce(new.goals, '[]'::jsonb)) g
    ),
    changed as (
      select
        ng.sender_user_id,
        count(*)::int as changed_count
      from new_goals ng
      left join old_goals og on og.goal_id = ng.goal_id
      where ng.sender_user_id is not null
        and (og.goal is null or og.goal is distinct from ng.goal)
      group by ng.sender_user_id
    )
    select * from changed
  loop
    perform public.create_social_feed_event(
      v_rec.sender_user_id,
      new.auth_user_id,
      'goal_transfer_updated',
      jsonb_build_object('changed_count', v_rec.changed_count),
      'account_states',
      null
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_feed_goal_update on public.account_states;
create trigger trg_feed_goal_update
after update on public.account_states
for each row execute procedure public.feed_goal_update_trigger();

create or replace function public.get_feed_events(p_limit int default 100)
returns table (
  id uuid,
  event_type text,
  actor_user_id uuid,
  actor_dj_name text,
  actor_infinitas_id text,
  actor_icon_data_url text,
  payload jsonb,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    e.id,
    e.event_type,
    e.actor_user_id,
    coalesce(u.dj_name, '') as actor_dj_name,
    coalesce(u.infinitas_id, '') as actor_infinitas_id,
    coalesce(u.icon_data_url, '') as actor_icon_data_url,
    e.payload,
    e.created_at
  from public.social_feed_events e
  left join public.users u on u.auth_user_id = e.actor_user_id
  where e.owner_user_id = auth.uid()
    and e.dismissed_at is null
  order by e.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 300));
$$;

revoke all on function public.get_feed_events(int) from public;
grant execute on function public.get_feed_events(int) to authenticated;

create or replace function public.dismiss_feed_event(p_event_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  update public.social_feed_events
  set dismissed_at = now()
  where id = p_event_id
    and owner_user_id = auth.uid()
    and dismissed_at is null
  returning true;
$$;

revoke all on function public.dismiss_feed_event(uuid) from public;
grant execute on function public.dismiss_feed_event(uuid) to authenticated;

create or replace function public.dismiss_all_feed_events()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update public.social_feed_events
  set dismissed_at = now()
  where owner_user_id = auth.uid()
    and dismissed_at is null;
  get diagnostics v_count = row_count;
  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.dismiss_all_feed_events() from public;
grant execute on function public.dismiss_all_feed_events() to authenticated;
