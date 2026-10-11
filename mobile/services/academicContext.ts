import { api } from './api';

export interface AcademicCohort {
  id: string;
  code: string;
  slotCode: string;
  displayName: string;
  currentSemester: number;
  intakeYear?: number;
  intakeIdentifier?: string | null;
  status: string;
  createdAt?: string;
  graduatedAt?: string | null;
}

export interface AcademicContextResponse {
  authenticated: boolean;
  role: 'student' | 'cr' | 'teacher' | 'admin' | 'anonymous';
  studentId?: string;
  name?: string;
  semester?: string | null;
  canViewAllCohorts: boolean;
  canManageCohorts?: boolean;
  cohort?: AcademicCohort | null;
  academicStatus?: 'active' | 'graduated' | 'unassigned';
  cohorts?: AcademicCohort[];
  displayLabel?: string;
  semesterRoman?: string;
}

const ROMAN_MAP: Record<number, string> = {
  1: 'Semester I',
  2: 'Semester II',
  3: 'Semester III',
  4: 'Semester IV',
  5: 'Semester V',
  6: 'Semester VI',
  7: 'Semester VII',
  8: 'Semester VIII',
};

export function semNumberToRoman(num: number): string {
  return ROMAN_MAP[num] || `Semester ${num}`;
}

export function parseSemesterNumber(val?: string | number | null): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') {
    return Number.isInteger(val) && val >= 1 && val <= 8 ? val : null;
  }
  const cleaned = String(val).replace(/^(?:semester|sem)\s*/i, '').trim().toUpperCase();
  const num = parseInt(cleaned, 10);
  if (!isNaN(num) && num >= 1 && num <= 8) return num;
  const ROMANS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
  const idx = ROMANS.indexOf(cleaned);
  return idx !== -1 ? idx + 1 : null;
}

export async function fetchAcademicContext(): Promise<AcademicContextResponse> {
  const data = await api.get<AcademicContextResponse>('/api/academic-context');
  if (data.cohort) {
    const semNum = data.cohort.currentSemester;
    const name = data.cohort.displayName || 'Cohort';
    data.displayLabel = `${name} • Semester ${semNum}`;
    data.semesterRoman = semNumberToRoman(semNum);
  } else if (data.canViewAllCohorts) {
    data.displayLabel = 'All Cohorts';
  } else if (data.semester) {
    const semNum = parseSemesterNumber(data.semester);
    if (semNum) {
      data.displayLabel = `Semester ${semNum}`;
      data.semesterRoman = semNumberToRoman(semNum);
    } else {
      data.displayLabel = 'Unassigned';
    }
  } else if (data.academicStatus === 'unassigned') {
    data.displayLabel = 'Unassigned';
  }
  return data;
}
