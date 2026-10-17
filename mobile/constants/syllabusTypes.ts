export interface SyllabusUnit {
  unitNumber: number;
  title: string;
  hours?: string;
  topics: string[];
}

export interface SyllabusCourse {
  code: string;
  title: string;
  credit: number;
  creditDisplay: string;
  nature: 'TH' | 'PR' | 'TH + PR';
  totalHours?: string;
  year: string;
  semester: string;
  cluster?: string;
  isElectiveSlot?: boolean;
  note?: string;
  prerequisites?: string[];
  objectives: string[];
  description?: string;
  outcomes?: string[];
  units: SyllabusUnit[];
  laboratoryWork?: string[];
  practicalQuestions?: string[];
  projectGuidelines?: {
    phases?: { title: string; description: string }[];
    requirements?: string[];
    documentItems?: string[];
    reportFormat?: string[];
  };
  textbooks?: string[];
  references?: string[];
}

export interface SyllabusSemester {
  id: string;
  semesterNumber: number;
  semesterRoman: string;
  year: string;
  yearNumber: number;
  title: string;
  shortTitle: string;
  totalCredits: number;
  totalCourses: number;
  description: string;
  courses: SyllabusCourse[];
}

export interface ElectiveCluster {
  id: string;
  number: number;
  name: string;
  description: string;
  courses: string[];
}

export interface UniversityProgramInfo {
  university: string;
  established: number;
  programName: string;
  shortName: string;
  bulletinDate: string;
  committee: string;
  durationYears: number;
  maxDurationYears: number;
  totalSemesters: number;
  totalCourses: number;
  totalCredits: number;
  minAttendancePercent: number;
  vision: string;
  mission: string;
  missionPillars: string[];
  learningOutcomes: string[];
  eligibility: string;
  careerProspects: string[];
  educationSystem: string[];
  undergraduatePrograms: string[];
}
