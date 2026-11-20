// Courses per school for online registration (and the profile edit form).
//
// A school listed here shows ONLY its own courses. Each course shows only its own majors and
// minors; a course with none hides the Major / Minor box. Schools that are not listed keep the
// full course list, as before.
//
// How to add a school: copy the NDMU block. The school name must be spelled exactly as in
// School Settings (capital letters and extra spaces do not matter). Majors are written without
// "Major in" (e.g. "Financial Management"), the same way they are saved.
//
//   'Course name': {}                                  no major, no minor
//   'Course name': { majors: ['A', 'B'] }              Major box shows A and B (optional)
//   'Course name': { minors: ['X', 'Y'] }              Minor box shows X and Y (required)
window.SCHOOL_COURSES = {
  'Notre Dame of Marbel University': {
    'Bachelor of Arts in Communication': {},
    'Bachelor of Arts in Philosophy': {},
    'Bachelor of Arts in Political Science': {},
    'Bachelor of Arts in Psychology': {},
    'Bachelor of Elementary Education': {},
    'Bachelor of Library and Information Science': {},
    'Bachelor of Physical Education': {},
    'Bachelor of Science in Accountancy': {},
    'Bachelor of Science in Architecture': {},
    'Bachelor of Science in Biology': {},
    'Bachelor of Science in Business Administration': {
      majors: ['Financial Management', 'Human Resource Management', 'Marketing Management'],
    },
    'Bachelor of Science in Chemistry': {},
    'Bachelor of Science in Civil Engineering': {
      majors: ['Structural Engineering'],
    },
    'Bachelor of Science in Computer Engineering': {},
    'Bachelor of Science in Computer Science': {},
    'Bachelor of Science in Criminology': {},
    'Bachelor of Science in Electrical Engineering': {},
    'Bachelor of Science in Electronics Engineering': {},
    'Bachelor of Science in Environmental Science': {},
    'Bachelor of Science in Hospitality Management': {},
    'Bachelor of Science in Information Technology': {},
    'Bachelor of Science in Management Accounting': {},
    'Bachelor of Science in Medical Technology': {},
    'Bachelor of Science in Nursing': {},
    'Bachelor of Science in Social Work': {},
    'Bachelor of Secondary Education': {
      majors: ['English', 'Filipino', 'Mathematics', 'Religious Education', 'Science', 'Social Studies'],
    },
    'Juris Doctor': {},
    'Masters in Legal Studies': {},
  },
};
