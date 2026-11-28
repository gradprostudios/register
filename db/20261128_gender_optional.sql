-- Gender is no longer asked in the portal (registration and profile).
-- student_save_profile on LIVE still requires it, so this makes it optional:
--   * removes the 'gender_required' check
--   * keeps the Gender already saved when the portal sends none
-- It edits the live function in place (nothing else in it changes).
-- If the live function doesn't look as expected, it stops and changes nothing.
--
-- Run in the Supabase SQL Editor (LIVE), all at once.

-- STEP 0 (read-only): want true, true
select prosrc like '%gender_required%'        as has_gender_check,
       prosrc like '%"Gender" = v_gender,%'   as sets_gender
from pg_proc where oid = 'public.student_save_profile(uuid,jsonb)'::regprocedure;

-- STEP 1: patch -------------------------------------------------------------------------------
do $patch$
declare
  v_def text := pg_get_functiondef('public.student_save_profile(uuid,jsonb)'::regprocedure);
  v_check text := 'if v_gender is null then raise exception ''gender_required''; end if;';
  v_set   text := '"Gender" = v_gender,';
begin
  if (length(v_def) - length(replace(v_def, v_check, ''))) / length(v_check) <> 1 then
    raise exception 'Stopped: the gender check was not found exactly once. Nothing changed.';
  end if;
  if (length(v_def) - length(replace(v_def, v_set, ''))) / length(v_set) <> 1 then
    raise exception 'Stopped: the Gender update line was not found exactly once. Nothing changed.';
  end if;
  v_def := replace(v_def, v_check, '-- Gender is optional (no longer asked in the portal).');
  v_def := replace(v_def, v_set, '"Gender" = coalesce(v_gender, "Gender"),');
  execute v_def;
end
$patch$;

-- STEP 2 (read-only): want false, true
select prosrc like '%gender_required%'                         as still_requires_gender,
       prosrc like '%coalesce(v_gender, "Gender")%'            as keeps_saved_gender
from pg_proc where oid = 'public.student_save_profile(uuid,jsonb)'::regprocedure;
