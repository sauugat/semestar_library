import {
  SyllabusUnit,
  SyllabusCourse,
  SyllabusSemester,
  ElectiveCluster,
  UniversityProgramInfo,
} from './syllabusTypes';
import { BIT_PROGRAM_INFO, ELECTIVE_CLUSTERS, SEMESTERS_PART_1 } from './syllabusPart1';
import { SEMESTERS_PART_2 } from './syllabusPart2';
import { SEMESTERS_PART_3 } from './syllabusPart3';
import { SEMESTERS_PART_4 } from './syllabusPart4';
import { ELECTIVE_COURSES } from './syllabusElectives';

export type {
  SyllabusUnit,
  SyllabusCourse,
  SyllabusSemester,
  ElectiveCluster,
  UniversityProgramInfo,
};

export { BIT_PROGRAM_INFO, ELECTIVE_CLUSTERS, ELECTIVE_COURSES };

export const BIT_SEMESTERS: SyllabusSemester[] = [
  ...SEMESTERS_PART_1,
  ...SEMESTERS_PART_2,
  ...SEMESTERS_PART_3,
  ...SEMESTERS_PART_4,
];

export const ALL_CORE_COURSES: SyllabusCourse[] = BIT_SEMESTERS.flatMap(
  (sem) => sem.courses
);

export const ALL_SYLLABUS_COURSES: SyllabusCourse[] = [
  ...ALL_CORE_COURSES.filter((c) => !c.isElectiveSlot),
  ...ELECTIVE_COURSES,
];

export function findSyllabusCourse(query: string): SyllabusCourse | null {
  if (!query) return null;
  const q = query.trim().toLowerCase();
  return (
    ALL_SYLLABUS_COURSES.find(
      (c) =>
        c.code.toLowerCase() === q ||
        c.title.toLowerCase() === q ||
        `${c.code}-${c.title}`.toLowerCase() === q
    ) ||
    ALL_SYLLABUS_COURSES.find(
      (c) =>
        c.title.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)
    ) ||
    null
  );
}

export function searchSyllabusCourses(query: string): SyllabusCourse[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return ALL_SYLLABUS_COURSES.filter((course) => {
    if (
      course.code.toLowerCase().includes(q) ||
      course.title.toLowerCase().includes(q) ||
      course.semester.toLowerCase().includes(q) ||
      course.year.toLowerCase().includes(q) ||
      (course.cluster && course.cluster.toLowerCase().includes(q))
    ) {
      return true;
    }
    if (
      course.objectives.some((o) => o.toLowerCase().includes(q)) ||
      (course.description && course.description.toLowerCase().includes(q)) ||
      (course.outcomes && course.outcomes.some((o) => o.toLowerCase().includes(q)))
    ) {
      return true;
    }
    return course.units.some(
      (u) =>
        u.title.toLowerCase().includes(q) ||
        u.topics.some((t) => t.toLowerCase().includes(q))
    );
  });
}
