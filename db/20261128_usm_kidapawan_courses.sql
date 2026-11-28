-- University of Southern Mindanao (Kidapawan): courses and majors (no minors).
-- Needs the tables from 20261120_school_courses.sql. Safe to run more than once.
-- School name matches the Details table. Majors are saved without "Major in".

insert into public.school_courses (school, name)
select 'University of Southern Mindanao (Kidapawan)', c
from unnest(array[
  'Bachelor of Industrial Technology',
  'Bachelor of Science in Electrical Engineering',
  'Bachelor of Science in Industrial Engineering',
  'Bachelor of Science in Mechanical Engineering',
  'Bachelor of Secondary Education',
  'Bachelor of Technical Vocational Teacher Education',
  'Bachelor of Technology',
  'Diploma of Technology',
  'Master of Arts in Education',
  'Master of Technology Education',
  'Doctor of Philosophy',
  'Master of Arts in Language and Literacy Education'
]) as c
on conflict do nothing;

-- Majors (optional for the student)
insert into public.course_majors (course_id, name)
select sc.id, m.major
from (values
  ('Bachelor of Industrial Technology',                  'Food and Beverage Preparation and Service Management'),
  ('Bachelor of Secondary Education',                    'English'),
  ('Bachelor of Secondary Education',                    'Filipino'),
  ('Bachelor of Secondary Education',                    'Mathematics'),
  ('Bachelor of Secondary Education',                    'Social Studies'),
  ('Bachelor of Technical Vocational Teacher Education', 'Automotive Technology'),
  ('Bachelor of Technical Vocational Teacher Education', 'Electronics Technology'),
  ('Bachelor of Technical Vocational Teacher Education', 'Food and Service Management'),
  ('Bachelor of Technical Vocational Teacher Education', 'Garments, Fashion, and Design'),
  ('Bachelor of Technology',                             'Automotive Technology'),
  ('Bachelor of Technology',                             'Civil Technology'),
  ('Bachelor of Technology',                             'Electrical Technology'),
  ('Bachelor of Technology',                             'Electronics Technology'),
  ('Bachelor of Technology',                             'Heating, Ventilating, and Air Conditioning Technology'),
  ('Bachelor of Technology',                             'Mechanical Technology'),
  ('Bachelor of Technology',                             'Welding and Fabrication'),
  ('Diploma of Technology',                              'Automotive Technology'),
  ('Diploma of Technology',                              'Civil Technology'),
  ('Diploma of Technology',                              'Electronics Technology'),
  ('Diploma of Technology',                              'Food Preparation and Service Technology'),
  ('Diploma of Technology',                              'Heating, Ventilating, and Air Conditioning Technology'),
  ('Diploma of Technology',                              'Welding and Fabrication'),
  ('Master of Arts in Education',                        'Educational Management'),
  ('Master of Arts in Education',                        'Organization and Management'),
  ('Doctor of Philosophy',                               'Technology Education Management')
) as m(course, major)
join public.school_courses sc
  on lower(trim(sc.school)) = 'university of southern mindanao (kidapawan)'
 and lower(trim(sc.name)) = lower(m.course)
on conflict do nothing;

-- Check: should list 12 courses and 25 majors in total.
select sc.name as course,
       coalesce((select string_agg(name, ', ' order by name) from public.course_majors where course_id = sc.id), '') as majors
from public.school_courses sc
where lower(trim(sc.school)) = 'university of southern mindanao (kidapawan)'
order by sc.name;
