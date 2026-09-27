import { api } from './api';

export interface SearchFileItem {
  id: number;
  originalName: string;
  title: string;
  semester: string | null;
  subject: string;
  chapter: string | null;
  sizeBytes: string | number;
  uploadedAt: string;
  uploadedBy: string;
  uploaderName: string;
  uploaderAvatar?: string | null;
  uploaderRole?: string;
  likeCount: string | number;
  liked: boolean | number;
  commentCount: string | number;
  isOfficial?: boolean;
  canDelete?: boolean;
}

export interface SearchSubjectItem {
  subject: string;
  fileCount: number;
  chapterCount: number;
}

export interface SearchStudentItem {
  studentId: string;
  name: string;
  avatarUrl?: string | null;
  role: string;
  department?: string | null;
  semester?: string | null;
  bio?: string | null;
  filesCount: number;
}

export interface SearchAssignmentItem {
  id: number;
  title: string;
  subject?: string;
  semester?: string;
  teacherName?: string;
  questionCount?: number;
  submissionCount?: number;
  mySubmissionCount?: number;
  dueDate?: string | null;
  createdAt?: string;
}

export interface SearchResponse {
  files: SearchFileItem[];
  subjects: SearchSubjectItem[];
  students: SearchStudentItem[];
  assignments?: SearchAssignmentItem[];
}

/**
 * Searches across files, subjects, students, and code lab assignments via GET /api/search
 */
export async function searchGlobal(query: string): Promise<SearchResponse> {
  const q = query.trim();
  if (!q) {
    return { files: [], subjects: [], students: [], assignments: [] };
  }
  return await api.get<SearchResponse>(`/api/search?q=${encodeURIComponent(q)}`);
}
