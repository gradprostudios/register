-- Lock pictorial bookings per school (AdDU first).
-- Once a student is booked, the student can no longer reschedule or cancel from the portal.
-- Students who have not booked yet can still book any open slot (e.g. the January slots).
-- Staff (admin Bookings tab) and the desktop app are NOT blocked.
--
-- Run in the Supabase SQL Editor (LIVE). Run STEP 1 as one block.

-- STEP 0 (read-only): check the school name and current settings ---------------------------
select school, is_enabled, reschedule_cutoff_hours from slot_settings order by school;

-- STEP 1: changes --------------------------------------------------------------------------
begin;

alter table public.slot_settings add column if not exists lock_changes boolean not null default false;

update public.slot_settings set lock_changes = true where school = 'Ateneo de Davao University';

-- Guard: blocks a student moving or cancelling a booked slot when the school is locked.
-- Only requests from the website (anon / signed-in non-staff) are blocked.
-- SQL Editor, desktop app (service_role or direct connection) and staff are allowed.
create or replace function public._guard_locked_booking_change()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_role text; v_locked boolean;
begin
  if old.status is distinct from 'booked' then return new; end if;
  if new.slot_id is not distinct from old.slot_id and new.status is distinct from 'cancelled' then
    return new;  -- e.g. marking 'completed' stays allowed
  end if;
  v_role := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                     nullif(current_setting('request.jwt.claims', true), '')::json->>'role');
  if v_role is null or v_role not in ('anon', 'authenticated') then return new; end if;
  if v_role = 'authenticated' and public.is_staff() then return new; end if;
  select s.lock_changes into v_locked from slot_settings s where s.school = old.school;
  if coalesce(v_locked, false) then raise exception 'changes_locked'; end if;
  return new;
end $function$;
revoke all on function public._guard_locked_booking_change() from public, anon, authenticated;

drop trigger if exists trg_guard_locked_booking_change on public.slot_bookings;
create trigger trg_guard_locked_booking_change
  before update on public.slot_bookings
  for each row execute function public._guard_locked_booking_change();

-- Portal asks this to hide the Reschedule / Cancel buttons.
create or replace function public.portal_changes_locked(p_token uuid)
returns boolean language plpgsql stable security definer set search_path to 'public' as $function$
declare v_user text; v_locked boolean;
begin
  v_user := public._student_from_token(p_token);
  select s.lock_changes into v_locked
    from "Clients" c join slot_settings s on s.school = trim(c."School")
   where c."Username" = v_user
   limit 1;
  return coalesce(v_locked, false);
end $function$;
revoke all on function public.portal_changes_locked(uuid) from public;
grant execute on function public.portal_changes_locked(uuid) to anon, authenticated;

commit;

-- STEP 2 (read-only): verify -----------------------------------------------------------------
select school, is_enabled, lock_changes from slot_settings order by school;
select tgname from pg_trigger where tgrelid = 'public.slot_bookings'::regclass and not tgisinternal;

-- To unlock later:  update slot_settings set lock_changes = false where school = 'Ateneo de Davao University';
