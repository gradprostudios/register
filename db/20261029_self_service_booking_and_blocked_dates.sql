-- Self-service reschedule/cancel (no staff approval), student activity log, and blocked dates.
-- Applied to the TEST project (goionmhlyaxtikapljes) on 2026-10-29. Apply to live only after
-- slot_booking_system and student_credentials_separation are there.

-- 1) Blocked dates (holidays / school no-duty days) per school -----------------------------
alter table public.slot_settings add column if not exists blocked_dates date[] not null default '{}';

-- 2) Student activity log (booked / rescheduled / cancelled). Server-side writes only. -----
create table if not exists public.booking_events (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.slot_bookings(id) on delete cascade,
  username text not null,
  school text not null,
  event text not null check (event in ('booked', 'rescheduled', 'cancelled')),
  from_slot_start timestamptz,
  to_slot_start timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists booking_events_created_idx on public.booking_events (created_at desc);
create index if not exists booking_events_school_idx on public.booking_events (school, created_at desc);
alter table public.booking_events enable row level security; -- no policies: read through staff_list_events only

-- 3) book_slot: unchanged behaviour, now also logs the booking ------------------------------
create or replace function public.book_slot(p_token uuid, p_slot_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_user text; v_school text; v_slot time_slots%rowtype; v_enabled boolean; v_id uuid;
begin
  v_user := public._student_from_token(p_token);
  select trim(c."School") into v_school from "Clients" c where c."Username" = v_user;
  select * into v_slot from time_slots where id = p_slot_id for update;
  if not found then raise exception 'slot_not_found'; end if;
  if lower(trim(v_slot.school)) <> lower(coalesce(v_school, '')) then raise exception 'wrong_school'; end if;
  select s.is_enabled into v_enabled from slot_settings s where s.school = v_slot.school;
  if not coalesce(v_enabled, false) then raise exception 'booking_closed'; end if;
  if v_slot.is_closed or v_slot.slot_start <= now() then raise exception 'slot_unavailable'; end if;
  if v_slot.booked_count >= v_slot.capacity then raise exception 'slot_full'; end if;
  if exists (select 1 from slot_bookings where username = v_user and status = 'booked') then
    raise exception 'already_booked';
  end if;
  insert into slot_bookings(username, school, slot_id) values (v_user, v_slot.school, v_slot.id) returning id into v_id;
  update time_slots set booked_count = booked_count + 1 where id = v_slot.id;
  insert into booking_events(booking_id, username, school, event, to_slot_start)
  values (v_id, v_user, v_slot.school, 'booked', v_slot.slot_start);
  return jsonb_build_object('booking_id', v_id, 'slot_id', v_slot.id, 'slot_start', v_slot.slot_start, 'slot_end', v_slot.slot_end);
exception when unique_violation then
  raise exception 'already_booked';
end $function$;

-- Shared guard: the student's active booking, refusing changes inside the cutoff window.
create or replace function public._student_active_booking(p_user text,
  out booking_id uuid, out school text, out slot_id uuid, out slot_start timestamptz)
language plpgsql security definer set search_path to 'public' as $function$
declare v_cutoff integer;
begin
  select bk.id, bk.school, bk.slot_id, t.slot_start into booking_id, school, slot_id, slot_start
    from slot_bookings bk join time_slots t on t.id = bk.slot_id
   where bk.username = p_user and bk.status = 'booked'
   for update of bk;
  if booking_id is null then raise exception 'no_active_booking'; end if;
  select coalesce(s.reschedule_cutoff_hours, 24) into v_cutoff from slot_settings s where s.school = _student_active_booking.school;
  if slot_start - make_interval(hours => coalesce(v_cutoff, 24)) < now() then raise exception 'past_cutoff'; end if;
end $function$;
revoke all on function public._student_active_booking(text) from public, anon, authenticated;

-- 4) Student reschedules straight into an open slot (no approval) ---------------------------
create or replace function public.student_reschedule(p_token uuid, p_slot_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_user text; b record; v_enabled boolean; n time_slots%rowtype;
begin
  v_user := public._student_from_token(p_token);
  select * into b from public._student_active_booking(v_user);
  select s.is_enabled into v_enabled from slot_settings s where s.school = b.school;
  if not coalesce(v_enabled, false) then raise exception 'booking_closed'; end if;
  -- _move_booking checks: same_slot, slot_not_found, wrong_school, slot_unavailable, slot_full
  perform public._move_booking(b.booking_id, p_slot_id);
  select * into n from time_slots where id = p_slot_id;
  -- Any old-style pending request is moot now.
  update reschedule_requests set status = 'withdrawn', resolved_at = now()
   where booking_id = b.booking_id and status = 'pending';
  insert into booking_events(booking_id, username, school, event, from_slot_start, to_slot_start)
  values (b.booking_id, v_user, b.school, 'rescheduled', b.slot_start, n.slot_start);
  return jsonb_build_object('booking_id', b.booking_id, 'slot_id', n.id, 'slot_start', n.slot_start, 'slot_end', n.slot_end);
end $function$;

-- 5) Student cancels (no approval); the seat goes back to the slot --------------------------
create or replace function public.student_cancel_booking(p_token uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_user text; b record;
begin
  v_user := public._student_from_token(p_token);
  select * into b from public._student_active_booking(v_user);
  update time_slots set booked_count = greatest(booked_count - 1, 0) where id = b.slot_id;
  update slot_bookings set status = 'cancelled', cancelled_at = now(), updated_at = now() where id = b.booking_id;
  update reschedule_requests set status = 'withdrawn', resolved_at = now()
   where booking_id = b.booking_id and status = 'pending';
  insert into booking_events(booking_id, username, school, event, from_slot_start)
  values (b.booking_id, v_user, b.school, 'cancelled', b.slot_start);
  return jsonb_build_object('cancelled', true);
end $function$;

revoke all on function public.student_reschedule(uuid, uuid) from public;
revoke all on function public.student_cancel_booking(uuid) from public;
grant execute on function public.student_reschedule(uuid, uuid) to anon, authenticated;
grant execute on function public.student_cancel_booking(uuid) to anon, authenticated;

-- 6) Slot generation skips blocked dates -----------------------------------------------------
create or replace function public.staff_generate_slots(p_school text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare s slot_settings%rowtype; d date; t time; t_end time; v_added integer := 0; v_n integer;
begin
  if not public.is_staff() then raise exception 'not_staff'; end if;
  select * into s from slot_settings where school = p_school;
  if not found then raise exception 'settings_not_found'; end if;
  for d in select g::date from generate_series(s.start_date::timestamp, s.end_date::timestamp, interval '1 day') g loop
    if extract(isodow from d)::integer = any (s.days_of_week::integer[])
       and not (d = any (coalesce(s.blocked_dates, '{}'))) then
      t := s.open_time;
      while t + make_interval(mins => s.slot_minutes) <= s.close_time loop
        t_end := t + make_interval(mins => s.slot_minutes);
        exit when t_end <= t;
        if s.lunch_start is null or not (t < s.lunch_end and t_end > s.lunch_start) then
          insert into time_slots(school, slot_start, slot_end, capacity)
          values (s.school, (d + t) at time zone 'Asia/Manila', (d + t_end) at time zone 'Asia/Manila', s.per_slot_capacity)
          on conflict (school, slot_start) do nothing;
          get diagnostics v_n = row_count;
          v_added := v_added + v_n;
        end if;
        t := t_end;
      end loop;
    end if;
  end loop;
  return jsonb_build_object('added', v_added);
end $function$;

-- 7) Staff sets blocked dates: newly blocked days close, unblocked days reopen ---------------
create or replace function public.staff_set_blocked_dates(p_school text, p_dates date[])
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_old date[]; v_new date[]; v_added date[]; v_removed date[]; v_closed integer := 0; v_reopened integer := 0; v_booked jsonb;
begin
  if not public.is_staff() then raise exception 'not_staff'; end if;
  select blocked_dates into v_old from slot_settings where school = p_school for update;
  if not found then raise exception 'settings_not_found'; end if;
  v_new := coalesce((select array_agg(distinct x order by x) from unnest(p_dates) x where x is not null), '{}');
  v_added := coalesce((select array_agg(x) from unnest(v_new) x where not (x = any (coalesce(v_old, '{}')))), '{}');
  v_removed := coalesce((select array_agg(x) from unnest(coalesce(v_old, '{}')) x where not (x = any (v_new))), '{}');
  update slot_settings set blocked_dates = v_new, updated_at = now() where school = p_school;
  update time_slots set is_closed = true
   where school = p_school and (slot_start at time zone 'Asia/Manila')::date = any (v_added);
  get diagnostics v_closed = row_count;
  update time_slots set is_closed = false
   where school = p_school and (slot_start at time zone 'Asia/Manila')::date = any (v_removed);
  get diagnostics v_reopened = row_count;
  -- Students already booked on a blocked day stay booked; staff move them from Bookings.
  select coalesce(jsonb_agg(jsonb_build_object('day', d, 'students', n) order by d), '[]') into v_booked
    from (select (t.slot_start at time zone 'Asia/Manila')::date d, count(*) n
            from slot_bookings b join time_slots t on t.id = b.slot_id
           where b.school = p_school and b.status = 'booked'
             and (t.slot_start at time zone 'Asia/Manila')::date = any (v_new)
           group by 1) q;
  return jsonb_build_object('blocked', v_new, 'closed_slots', v_closed, 'reopened_slots', v_reopened, 'booked_on_blocked', v_booked);
end $function$;

-- 8) Staff reads the activity log ------------------------------------------------------------
create or replace function public.staff_list_events(p_school text default null, p_limit integer default 300)
returns table(event_id uuid, event text, student_username text, full_name text, contact text, school_name text,
              from_slot_start timestamptz, to_slot_start timestamptz, created_at timestamptz)
language plpgsql security definer set search_path to 'public' as $function$
begin
  if not public.is_staff() then raise exception 'not_staff'; end if;
  return query
    select e.id, e.event, e.username, c."Full Name", c."Contact .", e.school, e.from_slot_start, e.to_slot_start, e.created_at
      from booking_events e left join "Clients" c on c."Username" = e.username
     where p_school is null or e.school = p_school
     order by e.created_at desc
     limit least(greatest(coalesce(p_limit, 300), 1), 2000);
end $function$;

revoke all on function public.staff_set_blocked_dates(text, date[]) from public, anon;
revoke all on function public.staff_list_events(text, integer) from public, anon;
grant execute on function public.staff_set_blocked_dates(text, date[]) to authenticated;
grant execute on function public.staff_list_events(text, integer) to authenticated;
