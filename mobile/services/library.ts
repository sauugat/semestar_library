import { api, apiFetch, ApiError, getBaseUrl } from './api';
import { normalizeUploadFile, validateFileSize } from '../utils/file-upload';

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
  upCount?: number;
  downCount?: number;
  myVote?: number;
  up_count?: number;
  down_count?: number;
  my_vote?: number;
  commentCount: string | number;
  isOfficial: boolean;
  canDelete?: boolean;
  fileUrl?: string;
  downloadUrl?: string;
  mimeType?: string;
  contentType?: string;
}

export interface GetFilesParams {
  semester?: string;
  subject?: string;
  chapter?: string;
  search?: string;
}

export interface LibraryStat {
  semester: string | null;
  subject: string;
  chapter: string | null;
  fileCount: number | string;
}

/**
 * Fetch library stats with file counts grouped by semester, subject, and chapter
 */
export async function getLibraryStats(): Promise<LibraryStat[]> {
  return await api.get<LibraryStat[]>('/api/library/stats');
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
 * Student Library: authoritatively loads notes/files for the student's active cohort & semester.
 * Does NOT send or require a manually selected client semester parameter.
 */
export async function getMyLibraryFiles(params: {
  subject?: string;
  chapter?: string;
  search?: string;
} = {}): Promise<LibraryFile[]> {
  const queryParts: string[] = [];

  if (params.subject) {
    queryParts.push(`subject=${encodeURIComponent(params.subject)}`);
  }
  if (params.chapter) {
    queryParts.push(`chapter=${encodeURIComponent(params.chapter)}`);
  }

  const queryString = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';
  const files = await api.get<LibraryFile[]>(`/api/library/files${queryString}`);

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
  if (!Number.isFinite(targetId) || targetId <= 0) return null;
  try {
    const file = await api.get<LibraryFile>(`/api/files/${targetId}`);
    return file || null;
  } catch (err: any) {
    if (err?.status === 404) return null;
    throw err;
  }
}

/**
 * Get direct download URL for a file
 */
export async function getFileDownloadUrl(id: number | string): Promise<string> {
  const baseUrl = await getBaseUrl();
  return `${baseUrl}/api/files/${id}/download`;
}

export interface OfficePreviewUrlResponse {
  previewFileUrl: string;
  expiresAt: string;
  expires: number;
}

/**
 * Fetch authenticated short-lived public signed preview URL for Office files
 */
export async function getOfficePreviewUrl(id: number | string): Promise<string> {
  const res = await api.get<OfficePreviewUrlResponse>(`/api/files/${id}/office-preview-url`);
  return res.previewFileUrl;
}

export interface ToggleFileLikeResult {
  liked: boolean;
  likeCount: number;
  upCount?: number;
  downCount?: number;
  myVote?: number;
}

const FILE_VOTES_STORAGE_KEY = 'semester_library_file_votes_v1';
let cachedFileVotes: Record<string, { myVote: number; upCount?: number; downCount?: number }> | null = null;

async function loadCachedFileVotes(): Promise<Record<string, { myVote: number; upCount?: number; downCount?: number }>> {
  if (cachedFileVotes) return cachedFileVotes;
  try {
    const SecureStore = require('expo-secure-store');
    const raw = await SecureStore.getItemAsync(FILE_VOTES_STORAGE_KEY);
    cachedFileVotes = raw ? JSON.parse(raw) : {};
  } catch {
    cachedFileVotes = {};
  }
  return cachedFileVotes || {};
}

async function saveCachedFileVote(
  fileId: number,
  state: { myVote: number; upCount: number; downCount: number }
): Promise<void> {
  const map = await loadCachedFileVotes();
  map[String(fileId)] = state;
  cachedFileVotes = map;
  try {
    const SecureStore = require('expo-secure-store');
    await SecureStore.setItemAsync(FILE_VOTES_STORAGE_KEY, JSON.stringify(map));
  } catch {}
}

export async function applyCachedFileVotes(files: LibraryFile[]): Promise<LibraryFile[]> {
  if (!Array.isArray(files) || files.length === 0) return [];
  const map = await loadCachedFileVotes();
  return files.map((f) => {
    const serverUp = Number(f.upCount ?? f.up_count ?? f.likeCount ?? 0);
    const serverDown = Number(f.downCount ?? f.down_count ?? 0);
    const hasServerMyVote = f.myVote !== undefined || f.my_vote !== undefined;
    const serverMyVote = Number(f.myVote ?? f.my_vote ?? (f.liked ? 1 : 0));
    const local = map[String(f.id)];

    if (local && (!hasServerMyVote || (serverMyVote === 0 && local.myVote !== 0))) {
      const upCount = local.myVote === 1 ? Math.max(serverUp, local.upCount ?? 1) : serverUp;
      const downCount = local.myVote === -1 ? Math.max(serverDown, local.downCount ?? 1) : serverDown;
      return {
        ...f,
        upCount,
        downCount,
        myVote: local.myVote,
        up_count: upCount,
        down_count: downCount,
        my_vote: local.myVote,
        likeCount: upCount,
        liked: local.myVote === 1,
      };
    }

    return {
      ...f,
      upCount: serverUp,
      downCount: serverDown,
      myVote: serverMyVote,
      up_count: serverUp,
      down_count: serverDown,
      my_vote: serverMyVote,
      likeCount: serverUp,
      liked: serverMyVote === 1,
    };
  });
}

/**
 * Vote (up/down) or toggle like for a file/material.
 * Endpoint: POST /api/files/:id/vote
 */
export async function voteFile(
  fileId: number,
  vote: 'up' | 'down',
  currentState?: { upCount?: number; downCount?: number; myVote?: number }
): Promise<{ upCount: number; downCount: number; myVote: number; liked: boolean; likeCount: number }> {
  const numId = Number(fileId);
  const map = await loadCachedFileVotes();
  const prevVote = Number(currentState?.myVote ?? map[String(numId)]?.myVote ?? 0);
  const prevUp = Number(currentState?.upCount ?? map[String(numId)]?.upCount ?? 0);
  const prevDown = Number(currentState?.downCount ?? map[String(numId)]?.downCount ?? 0);
  const desiredVote = vote === 'down' ? -1 : 1;
  const computedNextVote = prevVote === desiredVote ? 0 : desiredVote;
  const computedNextUp = Math.max(0, prevUp + (computedNextVote === 1 ? 1 : 0) - (prevVote === 1 ? 1 : 0));
  const computedNextDown = Math.max(0, prevDown + (computedNextVote === -1 ? 1 : 0) - (prevVote === -1 ? 1 : 0));

  try {
    const res = await api.post<any>(`/api/files/${numId}/vote`, { vote });
    const hasExplicitVote = res.myVote !== undefined || res.my_vote !== undefined;
    const upCount = Number(res.upCount ?? res.up_count ?? res.likeCount ?? computedNextUp);
    const downCount = Number(res.downCount ?? res.down_count ?? computedNextDown);
    const myVote = hasExplicitVote ? Number(res.myVote ?? res.my_vote ?? 0) : computedNextVote;
    await saveCachedFileVote(numId, { myVote, upCount, downCount });
    return {
      upCount,
      downCount,
      myVote,
      liked: myVote === 1,
      likeCount: upCount,
    };
  } catch {
    // Fallback to /api/files/:id/like if an older deployed instance does not have /vote yet
    try {
      const likeAction = computedNextVote === 1 ? 'like' : 'unlike';
      const res = await api.post<any>(`/api/files/${numId}/like`, {
        vote,
        action: likeAction,
        liked: computedNextVote === 1,
      });
      const hasExplicitVote = res.myVote !== undefined || res.my_vote !== undefined;
      const upCount = hasExplicitVote
        ? Number(res.upCount ?? res.up_count ?? res.likeCount ?? computedNextUp)
        : Number(res.likeCount ?? computedNextUp);
      const downCount = hasExplicitVote
        ? Number(res.downCount ?? res.down_count ?? computedNextDown)
        : computedNextDown;
      const myVote = hasExplicitVote
        ? Number(res.myVote ?? res.my_vote ?? 0)
        : computedNextVote;
      await saveCachedFileVote(numId, { myVote, upCount, downCount });
      return {
        upCount,
        downCount,
        myVote,
        liked: myVote === 1,
        likeCount: upCount,
      };
    } catch {
      await saveCachedFileVote(numId, {
        myVote: computedNextVote,
        upCount: computedNextUp,
        downCount: computedNextDown,
      });
      return {
        upCount: computedNextUp,
        downCount: computedNextDown,
        myVote: computedNextVote,
        liked: computedNextVote === 1,
        likeCount: computedNextUp,
      };
    }
  }
}

/**
 * Toggle like for a file/material.
 * Endpoint: POST /api/files/:id/like
 */
export async function toggleFileLike(
  fileId: number,
  currentLiked: boolean = false,
  voteDirection?: 'up' | 'down'
): Promise<ToggleFileLikeResult> {
  if (voteDirection) {
    return voteFile(fileId, voteDirection);
  }
  const res = await api.post<any>(`/api/files/${fileId}/like`, {
    action: currentLiked ? 'unlike' : 'like',
  });
  const upCount = Number(res.upCount ?? res.up_count ?? res.likeCount ?? 0);
  const downCount = Number(res.downCount ?? res.down_count ?? 0);
  const myVote = Number(res.myVote ?? res.my_vote ?? (res.liked ? 1 : 0));
  return {
    liked: Boolean(res.liked),
    likeCount: upCount,
    upCount,
    downCount,
    myVote,
  };
}

export interface UploadFileItem {
  uri: string;
  name: string;
  type?: string;
  size?: number;
  title?: string;
}

export interface UploadNoteParams {
  // Single file support
  fileUri?: string;
  fileName?: string;
  fileType?: string;
  fileSize?: number;

  // Multi-file batch support
  files?: UploadFileItem[];
  batchId?: string;

  title?: string;
  semester: string;
  subject: string;
  chapter?: string;
}

export interface UploadFailedFile {
  name: string;
  originalName?: string;
  error: string;
}

export interface UploadNoteResponse {
  message: string;
  batchId?: string;
  fileId?: number;
  files?: any[];
  successfulFiles?: any[];
  failedFiles?: UploadFailedFile[];
  count?: number;
  total?: number;
  isPartial?: boolean;
}

/**
 * Upload a note/material (or batch of materials) to the library.
 * Endpoint: POST /api/files/upload
 */
export async function uploadNote(params: UploadNoteParams): Promise<UploadNoteResponse> {
  const formData = new FormData();
  const fileList: UploadFileItem[] = [];

  if (params.files && params.files.length > 0) {
    fileList.push(...params.files);
  } else if (params.fileUri && params.fileName) {
    fileList.push({
      uri: params.fileUri,
      name: params.fileName,
      type: params.fileType,
      size: params.fileSize,
      title: params.title,
    });
  }

  if (fileList.length === 0) {
    throw new ApiError('No files selected for upload.', 400);
  }

  const titles: string[] = [];
  for (const item of fileList) {
    const normalized = normalizeUploadFile(
      {
        uri: item.uri,
        name: item.name,
        type: item.type,
        size: item.size,
      },
      'note.pdf'
    );
    validateFileSize(normalized.size, 250 * 1024 * 1024, 'Document');

    formData.append('files', {
      uri: normalized.uri,
      name: normalized.name,
      type: normalized.type || 'application/octet-stream',
    } as any);

    titles.push(item.title || item.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '));
  }

  formData.append('fileTitles', JSON.stringify(titles));

  if (params.batchId) {
    formData.append('batchId', params.batchId);
  }
  if (params.title && params.title.trim()) {
    formData.append('title', params.title.trim());
  }
  formData.append('semester', params.semester);
  formData.append('subject', params.subject);
  if (params.chapter && params.chapter.trim()) {
    formData.append('chapter', params.chapter.trim());
  }

  const res = await apiFetch('/api/files/upload', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok && res.status !== 207) {
    const errBody = await res.json().catch(() => ({}));
    throw new ApiError(errBody.message || `Upload failed (HTTP ${res.status})`, res.status, errBody);
  }

  return res.json();
}

export interface FileComment {
  id: number;
  fileId: number;
  postId?: number;
  userId?: string;
  studentId: string;
  commentText: string;
  content: string;
  createdAt: string;
  updatedAt?: string | null;
  edited?: boolean;
  commenterName: string;
  name: string;
  avatarUrl?: string | null;
  role: string;
  parentCommentId?: number | null;
  replyToUserId?: string | null;
  replyToUser?: {
    studentId: string;
    name: string;
  } | null;
  reactionCount?: number;
  reactedByMe?: boolean;
  replyCount?: number;
  replies?: FileComment[];
  canDelete?: boolean;
  canEdit?: boolean;
}

export async function getFileComments(fileId: number): Promise<FileComment[]> {
  return api.get<FileComment[]>(`/api/files/${fileId}/comments`);
}

export async function addFileComment(
  fileId: number,
  text: string,
  options?: {
    parentCommentId?: number | null;
    replyToUserId?: string | null;
  }
): Promise<{ commentId: number; comment?: FileComment; commentCount: number }> {
  return api.post(`/api/files/${fileId}/comments`, {
    text,
    content: text,
    parent_comment_id: options?.parentCommentId ?? null,
    reply_to_user_id: options?.replyToUserId ?? null,
  });
}

export async function editFileComment(
  fileId: number,
  commentId: number,
  content: string
): Promise<{ comment: FileComment; message: string }> {
  return api.put(`/api/files/${fileId}/comments/${commentId}`, { content, text: content });
}

export async function toggleFileCommentReaction(
  fileId: number,
  commentId: number
): Promise<{ reacted: boolean; reactionCount: number; reaction_count: number }> {
  return api.post(`/api/files/${fileId}/comments/${commentId}/like`, {});
}

export async function deleteFileComment(
  fileId: number,
  commentId: number
): Promise<{ message: string; commentCount: number }> {
  return api.delete(`/api/files/${fileId}/comments/${commentId}`);
}

