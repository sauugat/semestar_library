import { api, getBaseUrl } from './api';

export interface LibrarySubject {
  subject: string;
  filecount: string | number;
  chaptercount: string | number;
}

export interface LibraryChapter {
  chapter: string;
  filecount: string | number;
}

export interface LibraryChaptersResponse {
  chapters: LibraryChapter[];
  uncategorizedCount: number;
}

export interface LibraryFile {
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
  uploaderAvatar?: string;
  uploaderRole: string;
  likeCount: string | number;
  liked: boolean;
  commentCount: string | number;
  isOfficial: boolean;
  canDelete?: boolean;
}

export interface GetFilesParams {
  semester?: string;
  subject?: string;
  chapter?: string;
  search?: string;
}

/**
 * Fetch all subjects with file and chapter counts
 */
export async function getSubjects(): Promise<LibrarySubject[]> {
  return await api.get<LibrarySubject[]>('/api/library/subjects');
}

/**
 * Fetch chapters and uncategorized count for a given subject
 */
export async function getChapters(subject: string): Promise<LibraryChaptersResponse> {
  const encoded = encodeURIComponent(subject);
  return await api.get<LibraryChaptersResponse>(`/api/library/subjects/${encoded}/chapters`);
}

/**
 * Fetch library files filtered by semester, subject, chapter, or search query
 */
export async function getFiles(params: GetFilesParams = {}): Promise<LibraryFile[]> {
  const queryParts: string[] = [];

  if (params.semester) {
    queryParts.push(`semester=${encodeURIComponent(params.semester)}`);
  }
  if (params.subject) {
    queryParts.push(`subject=${encodeURIComponent(params.subject)}`);
  }
  if (params.chapter) {
    queryParts.push(`chapter=${encodeURIComponent(params.chapter)}`);
  }

  const queryString = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';
  const files = await api.get<LibraryFile[]>(`/api/library/files${queryString}`);

  // If a client-side search query is provided, filter title, subject, and filename
  if (params.search && params.search.trim()) {
    const q = params.search.trim().toLowerCase();
    return files.filter((f) =>
      (f.title && f.title.toLowerCase().includes(q)) ||
      (f.originalName && f.originalName.toLowerCase().includes(q)) ||
      (f.subject && f.subject.toLowerCase().includes(q)) ||
      (f.chapter && f.chapter.toLowerCase().includes(q))
    );
  }

  return files;
}

/**
 * Fetch details of a single file by ID
 */
export async function getFileById(id: number | string): Promise<LibraryFile | null> {
  const targetId = Number(id);
  // Fetch files and locate the file with matching ID
  const allFiles = await api.get<LibraryFile[]>('/api/library/files');
  const found = allFiles.find((f) => Number(f.id) === targetId);
  return found || null;
}

/**
 * Get direct download URL for a file
 */
export async function getFileDownloadUrl(id: number | string): Promise<string> {
  const baseUrl = await getBaseUrl();
  return `${baseUrl}/api/files/${id}/download`;
}

export interface ToggleFileLikeResult {
  liked: boolean;
  likeCount: number;
}

/**
 * Toggle like for a file/material.
 * Endpoint: POST /api/files/:id/like
 */
export async function toggleFileLike(
  fileId: number,
  currentLiked: boolean = false
): Promise<ToggleFileLikeResult> {
  const res = await api.post<ToggleFileLikeResult>(`/api/files/${fileId}/like`, {
    action: currentLiked ? 'unlike' : 'like',
  });
  return {
    liked: Boolean(res.liked),
    likeCount: Number(res.likeCount ?? 0),
  };
}
