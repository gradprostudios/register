-- Ateneo de Davao University (AdDU): courses, majors and minors.
-- Needs the tables from 20261120_school_courses.sql. Safe to run more than once.
-- Names follow how they are already saved (Details table): majors without "Major in",
-- engineering as "Bachelor of Science in ... Engineering", Anthropology tracks as separate courses.

insert into public.school_courses (school, name)
select 'Ateneo de Davao University', c
from unnest(array[
  -- School of Arts and Sciences: Computer Studies
  'Bachelor of Science in Computer Science',
  'Bachelor of Science in Data Science',
  'Bachelor of Science in Information Systems',
  'Bachelor of Science in Information Technology',
  -- Humanities and Letters
  'Bachelor of Arts in English Language',
  'Bachelor of Arts in Interdisciplinary Studies',
  'Bachelor of Arts in Communication',
  'Bachelor of Arts in Philosophy',
  -- Natural Sciences and Mathematics
  'Bachelor of Science in Biology',
  'Bachelor of Science in Chemistry',
  'Bachelor of Science in Mathematics',
  'Bachelor of Science in Environmental Science',
  'Bachelor of Science in Physics',
  -- Social Sciences
  'Bachelor of Arts in Anthropology (Academic Research Track)',
  'Bachelor of Arts in Anthropology (Community Development and Social Enterprise Track)',
  'Bachelor of Arts in Anthropology (IP Education Track)',
  'Bachelor of Arts in Anthropology (Pre-Law Track)',
  'Bachelor of Arts in Anthropology (Medical Anthropology Track)',
  'Bachelor of Arts in Psychology',
  'Bachelor of Science in Psychology',
  'Bachelor of Arts in Political Science',
  'Bachelor of Arts in Economics',
  'Bachelor of Science in Social Work',
  'Bachelor of Arts in Islamic Studies',
  'Bachelor of Arts in International Studies',
  'Bachelor of Arts in Development Studies',
  'Bachelor of Arts in Sociology',
  -- School of Business and Governance
  'Bachelor of Science in Accountancy',
  'Bachelor of Science in Management Accounting',
  'Bachelor of Science in Business Management',
  'Bachelor of Science in Marketing',
  'Bachelor of Science in Entrepreneurship',
  'Bachelor of Public Management',
  'Bachelor of Science in Human Resource Development and Management',
  'Bachelor of Science in Finance',
  -- School of Education
  'Bachelor of Early Childhood Education',
  'Bachelor of Elementary Education',
  'Bachelor of Secondary Education',
  -- School of Engineering and Architecture
  'Bachelor of Science in Architecture',
  'Bachelor of Science in Aerospace Engineering',
  'Bachelor of Science in Chemical Engineering',
  'Bachelor of Science in Civil Engineering',
  'Bachelor of Science in Computer Engineering',
  'Bachelor of Science in Electrical Engineering',
  'Bachelor of Science in Electronics Engineering',
  'Bachelor of Science in Industrial Engineering',
  'Bachelor of Science in Mechanical Engineering',
  'Bachelor of Science in Robotics Engineering',
  -- School of Nursing
  'Bachelor of Science in Nursing'
]) as c
on conflict do nothing;

-- Majors (optional for the student)
insert into public.course_majors (course_id, name)
select sc.id, m.major
from (values
  ('Bachelor of Science in Biology',             'General Biology'),
  ('Bachelor of Science in Biology',             'Medical Biology'),
  ('Bachelor of Arts in International Studies',  'American Studies'),
  ('Bachelor of Arts in International Studies',  'Asian Studies'),
  ('Bachelor of Science in Entrepreneurship',    'Agribusiness'),
  ('Bachelor of Secondary Education',            'English'),
  ('Bachelor of Secondary Education',            'Mathematics'),
  ('Bachelor of Secondary Education',            'Social Studies'),
  ('Bachelor of Secondary Education',            'Science')
) as m(course, major)
join public.school_courses sc
  on lower(trim(sc.school)) = 'ateneo de davao university'
 and lower(trim(sc.name)) = lower(m.course)
on conflict do nothing;

-- Minors (required for the student when the course has them)
insert into public.course_minors (course_id, name)
select sc.id, m.minor
from (values
  ('Bachelor of Arts in Interdisciplinary Studies', 'Language and Literature'),
  ('Bachelor of Arts in Interdisciplinary Studies', 'Media and Philosophy'),
  ('Bachelor of Arts in Interdisciplinary Studies', 'Media and Technology'),
  ('Bachelor of Arts in Interdisciplinary Studies', 'Media and Business'),
  ('Bachelor of Arts in Interdisciplinary Studies', 'Philosophy and Theology')
) as m(course, minor)
join public.school_courses sc
  on lower(trim(sc.school)) = 'ateneo de davao university'
 and lower(trim(sc.name)) = lower(m.course)
on conflict do nothing;

-- Check: should list 49 courses; majors on Biology (2), International Studies (2),
-- Entrepreneurship (1), Secondary Education (4); minors on Interdisciplinary Studies (5).
select sc.name as course,
       coalesce((select string_agg(name, ', ' order by name) from public.course_majors where course_id = sc.id), '') as majors,
       coalesce((select string_agg(name, ', ' order by name) from public.course_minors where course_id = sc.id), '') as minors
from public.school_courses sc
where lower(trim(sc.school)) = 'ateneo de davao university'
order by sc.name;
