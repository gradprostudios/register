-- No reschedule/cancel cutoff: students can change or cancel any time before their slot starts.
-- Applied to the TEST project (goionmhlyaxtikapljes) on 2026-10-29, after
-- 20261029_hourly_slots_by_total_students.sql.

-- The cutoff column stays for the old request_change flow, but is zero everywhere now.
alter table public.slot_settings alter column reschedule_cutoff_hours set default 0;
update public.slot_settings set reschedule_cutoff_hours = 0 where reschedule_cutoff_hours <> 0;

-- Shared guard for student_reschedule / student_cancel_booking: only refuses once the slot has started.
create or replace function public._student_active_booking(p_user text,
  out booking_id uuid, out school text, out slot_id uuid, out slot_start timestamptz)
language plpgsql security definer set search_path to 'public' as $function$
begin
  select bk.id, bk.school, bk.slot_id, t.slot_start into booking_id, school, slot_id, slot_start
    from slot_bookings bk join time_slots t on t.id = bk.slot_id
   where bk.username = p_user and bk.status = 'booked'
   for update of bk;
  if booking_id is null then raise exception 'no_active_booking'; end if;
  if slot_start <= now() then raise exception 'booking_started'; end if;
end $function$;
revoke all on function public._student_active_booking(text) from public, anon, authenticated;
