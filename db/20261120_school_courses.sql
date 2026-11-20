-- Courses per school, with each course's majors and minors.
-- A school with rows here shows ONLY these courses in the portal (registration + profile edit);
-- a course shows the Major / Minor box only when it has majors / minors here.
-- A school with no rows keeps the full course list from the Details table.
--
-- school = the school name exactly as in School Settings (slot_settings.school). Capital letters
-- and extra spaces do not matter. Majors are written without "Major in" (e.g. "Financial Management").
-- Students can only read these tables; add / edit rows in the Supabase Table Editor.
-- Safe to run more than once.

create table if not exists public.school_courses (
  id bigint generated always as identity primary key,
  school text not null,
  name text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists school_courses_school_name_key
  on public.school_courses (lower(trim(school)), lower(trim(name)));

create table if not exists public.course_majors (
  id bigint generated always as identity primary key,
  course_id bigint not null references public.school_courses(id) on delete cascade,
  name text not null
);
create unique index if not exists course_majors_course_name_key
  on public.course_majors (course_id, lower(trim(name)));

create table if not exists public.course_minors (
  id bigint generated always as identity primary key,
  course_id bigint not null references public.school_courses(id) on delete cascade,
  name text not null
);
create unique index if not exists course_minors_course_name_key
  on public.course_minors (course_id, lower(trim(name)));

-- Read-only for everyone (a course list is public information); no insert/update/delete policies.
alter table public.school_courses enable row level security;
alter table public.course_majors  enable row level security;
alter table public.course_minors  enable row level security;
drop policy if exists "Anyone can read school courses" on public.school_courses;
drop policy if exists "Anyone can read course majors"  on public.course_majors;
drop policy if exists "Anyone can read course minors"  on public.course_minors;
create policy "Anyone can read school courses" on public.school_courses for select using (true);
create policy "Anyone can read course majors"  on public.course_majors  for select using (true);
create policy "Anyone can read course minors"  on public.course_minors  for select using (true);
grant select on public.school_courses, public.course_majors, public.course_minors to anon, authenticated;

-- ============================================================================================
-- Notre Dame of Marbel University (NDMU)
-- ============================================================================================
insert into public.school_courses (school, name)
select 'Notre Dame of Marbel University', c
from unnest(array[
  'Bachelor of Arts in Communication',
  'Bachelor of Arts in Philosophy',
  'Bachelor of Arts in Political Science',
  'Bachelor of Arts in Psychology',
  'Bachelor of Elementary Education',
  'Bachelor of Library and Information Science',
  'Bachelor of Physical Education',
  'Bachelor of Science in Accountancy',
  'Bachelor of Science in Architecture',
  'Bachelor of Science in Biology',
  'Bachelor of Science in Business Administration',
  'Bachelor of Science in Chemistry',
  'Bachelor of Science in Civil Engineering',
  'Bachelor of Science in Computer Engineering',
  'Bachelor of Science in Computer Science',
  'Bachelor of Science in Criminology',
  'Bachelor of Science in Electrical Engineering',
  'Bachelor of Science in Electronics Engineering',
  'Bachelor of Science in Environmental Science',
  'Bachelor of Science in Hospitality Management',
  'Bachelor of Science in Information Technology',
  'Bachelor of Science in Management Accounting',
  'Bachelor of Science in Medical Technology',
  'Bachelor of Science in Nursing',
  'Bachelor of Science in Social Work',
  'Bachelor of Secondary Education',
  'Juris Doctor',
  'Masters in Legal Studies'
]) as c
on conflict do nothing;

insert into public.course_majors (course_id, name)
select sc.id, m.major
from (values
  ('Bachelor of Science in Business Administration', 'Financial Management'),
  ('Bachelor of Science in Business Administration', 'Human Resource Management'),
  ('Bachelor of Science in Business Administration', 'Marketing Management'),
  ('Bachelor of Science in Civil Engineering',       'Structural Engineering'),
  ('Bachelor of Secondary Education',                'English'),
  ('Bachelor of Secondary Education',                'Filipino'),
  ('Bachelor of Secondary Education',                'Mathematics'),
  ('Bachelor of Secondary Education',                'Religious Education'),
  ('Bachelor of Secondary Education',                'Science'),
  ('Bachelor of Secondary Education',                'Social Studies')
) as m(course, major)
join public.school_courses sc
  on lower(trim(sc.school)) = 'notre dame of marbel university'
 and lower(trim(sc.name)) = lower(m.course)
on conflict do nothing;

-- Check: should list 28 courses, with majors on BSBA (3), Civil Engineering (1) and BSED (6).
select sc.name as course,
       coalesce(string_agg(cm.name, ', ' order by cm.name), '') as majors
from public.school_courses sc
left join public.course_majors cm on cm.course_id = sc.id
where lower(trim(sc.school)) = 'notre dame of marbel university'
group by sc.name
order by sc.name;
