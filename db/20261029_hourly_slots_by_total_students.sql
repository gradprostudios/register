-- Hourly slots sized from the school's total number of students.
-- Staff enter "Total students"; the admin page divides it across every hourly slot in the
-- schedule and saves the result as per_slot_capacity (slot_minutes is always 60 now).
-- Applied to the TEST project (goionmhlyaxtikapljes) on 2026-10-29, after
-- 20261029_self_service_booking_and_blocked_dates.sql.

alter table public.slot_settings
  add column if not exists total_students integer check (total_students is null or total_students >= 0);

-- Push a new per-hour capacity onto the school's upcoming slots. A slot never drops below the
-- number of students already booked in it.
create or replace function public.staff_apply_capacity(p_school text, p_capacity integer)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_updated integer; v_kept integer;
begin
  if not public.is_staff() then raise exception 'not_staff'; end if;
  if p_capacity is null or p_capacity < 0 then raise exception 'invalid_capacity'; end if;
  select count(*) into v_kept from time_slots
   where school = p_school and slot_start > now() and booked_count > p_capacity;
  update time_slots set capacity = greatest(p_capacity, booked_count)
   where school = p_school and slot_start > now() and capacity <> greatest(p_capacity, booked_count);
  get diagnostics v_updated = row_count;
  return jsonb_build_object('updated', v_updated, 'kept_higher', v_kept);
end $function$;

-- Rebuild the school's upcoming slots from the current settings:
--  1. delete upcoming slots nobody has ever booked (no booking rows at all),
--  2. create / reshape every slot of the current grid (hours, lunch, days, blocked dates),
--  3. close every leftover upcoming slot that is not on the grid (no new bookings there).
-- Students already booked in a leftover slot stay booked; staff move them from Bookings.
create or replace function public.staff_rebuild_slots(p_school text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare s slot_settings%rowtype; d date; t time; t_end time; v_start timestamptz; v_starts timestamptz[] := '{}';
        v_removed integer; v_made integer := 0; v_n integer; v_closed integer;
begin
  if not public.is_staff() then raise exception 'not_staff'; end if;
  select * into s from slot_settings where school = p_school for update;
  if not found then raise exception 'settings_not_found'; end if;

  delete from time_slots ts
   where ts.school = p_school and ts.slot_start > now()
     and not exists (select 1 from slot_bookings b where b.slot_id = ts.id);
  get diagnostics v_removed = row_count;

  for d in select g::date from generate_series(s.start_date::timestamp, s.end_date::timestamp, interval '1 day') g loop
    if extract(isodow from d)::integer = any (s.days_of_week::integer[])
       and not (d = any (coalesce(s.blocked_dates, '{}'))) then
      t := s.open_time;
      while t + make_interval(mins => s.slot_minutes) <= s.close_time loop
        t_end := t + make_interval(mins => s.slot_minutes);
        exit when t_end <= t;
        if s.lunch_start is null or not (t < s.lunch_end and t_end > s.lunch_start) then
          v_start := (d + t) at time zone 'Asia/Manila';
          if v_start > now() then
            v_starts := v_starts || v_start;
            insert into time_slots(school, slot_start, slot_end, capacity)
            values (s.school, v_start, (d + t_end) at time zone 'Asia/Manila', s.per_slot_capacity)
            on conflict (school, slot_start) do update
              set slot_end = excluded.slot_end,
                  capacity = greatest(excluded.capacity, time_slots.booked_count),
                  is_closed = false;
            get diagnostics v_n = row_count;
            v_made := v_made + v_n;
          end if;
        end if;
        t := t_end;
      end loop;
    end if;
  end loop;

  update time_slots set is_closed = true
   where school = p_school and slot_start > now() and not is_closed
     and not (slot_start = any (v_starts));
  get diagnostics v_closed = row_count;

  return jsonb_build_object('removed', v_removed, 'slots', v_made, 'closed_leftovers', v_closed,
    'kept_booked', (select count(*) from time_slots where school = p_school and slot_start > now()
                      and booked_count > 0 and not (slot_start = any (v_starts))));
end $function$;

revoke all on function public.staff_apply_capacity(text, integer) from public, anon;
revoke all on function public.staff_rebuild_slots(text) from public, anon;
grant execute on function public.staff_apply_capacity(text, integer) to authenticated;
grant execute on function public.staff_rebuild_slots(text) to authenticated;
