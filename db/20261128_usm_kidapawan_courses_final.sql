-- University of Southern Mindanao (Kidapawan): FINAL course list (replaces 20261128_usm_kidapawan_courses.sql).
-- Clears this school's course list and puts back the final one. Students already registered keep
-- what they saved; only the choices in the portal change. Safe to run more than once.
-- Run in the Supabase SQL Editor (LIVE), all at once.

begin;

delete from public.school_courses
 where lower(trim(school)) = 'university of southern mindanao (kidapawan)';   -- majors go with it (cascade)

insert into public.school_courses (school, name)
select 'University of Southern Mindanao (Kidapawan)', c
from unnest(array[
  -- College of Engineering
  'Bachelor of Science in Electrical Engineering',
  'Bachelor of Science in Industrial Engineering',
  'Bachelor of Science in Mechanical Engineering',
  -- College of Education, Arts, and Sciences
  'Bachelor of Secondary Education',
  'Bachelor of Technical Vocational Teacher Education',
  -- College of Technology
  'Bachelor of Technology',
  'Bachelor of Industrial Technology',
  -- Diploma
  'Diploma of Technology'
]) as c;

insert into public.course_majors (course_id, name)
select sc.id, m.major
from (values
  ('Bachelor of Secondary Education',                    'English'),
  ('Bachelor of Secondary Education',                    'Filipino'),
  ('Bachelor of Secondary Education',                    'Mathematics'),
  ('Bachelor of Secondary Education',                    'Social Studies'),
  ('Bachelor of Technical Vocational Teacher Education', 'Garments, Fashion, and Design'),
  ('Bachelor of Technical Vocational Teacher Education', 'Food and Service Management'),
  ('Bachelor of Technical Vocational Teacher Education', 'Automotive Technology'),
  ('Bachelor of Technical Vocational Teacher Education', 'Electronics Technology'),
  ('Bachelor of Technology',                             'Civil Technology'),
  ('Bachelor of Technology',                             'Electrical Technology'),
  ('Bachelor of Technology',                             'Electronics Technology'),
  ('Bachelor of Technology',                             'Mechanical Technology'),
  ('Bachelor of Technology',                             'Heating, Ventilating, and Air-Conditioning Technology'),
  ('Bachelor of Technology',                             'Welding and Fabrication Technology'),
  ('Bachelor of Industrial Technology',                  'Food Service Management'),
  ('Diploma of Technology',                              'Civil Technology'),
  ('Diploma of Technology',                              'Electrical Technology'),
  ('Diploma of Technology',                              'Electronics Technology'),
  ('Diploma of Technology',                              'Mechanical Technology'),
  ('Diploma of Technology',                              'Heating, Ventilating, and Air-Conditioning Technology'),
  ('Diploma of Technology',                              'Welding and Fabrication Technology'),
  ('Diploma of Technology',                              'Food Preparation Service Technology')
) as m(course, major)
join public.school_courses sc
  on lower(trim(sc.school)) = 'university of southern mindanao (kidapawan)'
 and lower(trim(sc.name)) = lower(m.course);

commit;

-- Check: should list 8 courses and 22 majors in total.
select sc.name as course,
       coalesce((select string_agg(name, ', ' order by name) from public.course_majors where course_id = sc.id), '') as majors
from public.school_courses sc
where lower(trim(sc.school)) = 'university of southern mindanao (kidapawan)'
order by sc.name;
