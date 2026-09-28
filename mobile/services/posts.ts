import { api, apiFetch, ApiError, getBaseUrl } from './api';
import { LibraryFile, toggleFileLike } from './library';
import { normalizeUploadFile, validateFileSize, RawFileAsset } from '../utils/file-upload';

export type { LibraryFile };
export { toggleFileLike };

export interface CreatePostParams {
  content: string;
  type?: 'status' | 'assignment' | 'notice';
  imageUri?: string | null;
  image?: RawFileAsset | null;
  official?: boolean;
}

export interface Post {
  id: number;
  user_id: string;
  content: string;
  type: 'status' | 'assignment' | 'notice';
  attachment_url: string | null;
  created_at: string;
  name: string;
  role: string;
  avatarUrl: string | null;
  studentId: string;
  like_count: number;
  comment_count: number;
  submission_count: number;
  liked_by_me: boolean;
  is_official?: boolean;
  canDelete?: boolean;
}

export interface PostComment {
  id: number;
  postId: number;
  userId: string;
  studentId: string;
  content: string;
  createdAt: string;
  name: string;
  role: string;
  avatarUrl: string | null;
  canDelete?: boolean;
}

export interface PostsResponse {
  posts: Post[];
  nextCursor: number | null;
}

export interface ToggleLikeResult {
  liked: boolean;
  likeCount: number;
  liked_by_me: boolean;
  like_count: number;
}

/**
 * Fetch posts with cursor-based pagination.
 * @param cursor The 'before' post ID for the next page.
 * @param limit Number of posts per page (default: 20).
 * @param type Optional post type filter ('status' | 'assignment' | 'notice').
 */
export async function getPosts(
  cursor?: number | null,
  limit: number = 20,
  type?: 'status' | 'assignment' | 'notice'
): Promise<PostsResponse> {
  const query = new URLSearchParams();
  query.append('limit', String(limit));
  if (cursor !== undefined && cursor !== null) {
    query.append('before', String(cursor));
  }
  if (type) {
    query.append('type', type);
  }

  const res = await api.get<PostsResponse>(`/api/posts?${query.toString()}`);
  return {
    posts: Array.isArray(res.posts) ? res.posts : [],
    nextCursor: res.nextCursor ?? null,
  };
}

/**
 * Fetch uploaded library files for merging into the Campus Feed.
 */
export async function getFeedFiles(): Promise<LibraryFile[]> {
  try {
    const res = await api.get<LibraryFile[]>('/api/files');
    return Array.isArray(res) ? res : [];
  } catch (err) {
    console.warn('Failed to fetch /api/files for feed:', err);
    return [];
  }
}

/**
 * Toggle like for a post. If already liked, sends DELETE; otherwise sends POST.
 */
export async function toggleLike(postId: number, currentLiked: boolean = false): Promise<ToggleLikeResult> {
  if (currentLiked) {
    return api.delete<ToggleLikeResult>(`/api/posts/${postId}/like`);
  }
  return api.post<ToggleLikeResult>(`/api/posts/${postId}/like`);
}

/**
 * Fetch comments for a post.
 */
export async function getComments(postId: number): Promise<PostComment[]> {
  return api.get<PostComment[]>(`/api/posts/${postId}/comments`);
}

/**
 * Deletes a post by ID.
 */
export async function deletePost(postId: number): Promise<{ message: string }> {
  return api.delete<{ message: string }>(`/api/posts/${postId}`);
}

/**
 * Creates a new post with text, optional image, and type.
 */
export async function createPost(params: CreatePostParams): Promise<Post> {
  const formData = new FormData();
  formData.append('content', params.content.trim());
  formData.append('type', params.type || 'status');

  if (params.official) {
    formData.append('official', 'true');
  }

  const rawImage = params.image || (params.imageUri ? { uri: params.imageUri } : null);
  if (rawImage && rawImage.uri) {
    const normalized = normalizeUploadFile(rawImage, `post_${Date.now()}.jpg`);
    validateFileSize(normalized.size, 5 * 1024 * 1024, 'Post image');

    formData.append('image', {
      uri: normalized.uri,
      name: normalized.name,
      type: normalized.type,
    } as any);
  }

  const res = await apiFetch('/api/posts', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new ApiError(errBody.message || `Failed to create post (HTTP ${res.status})`, res.status, errBody);
  }

  return res.json();
}

/**
 * Resolves a full image/attachment URL given a relative or absolute URL.
 */
export async function resolveAttachmentUrl(attachmentUrl: string | null): Promise<string | null> {
  if (!attachmentUrl) return null;
  if (attachmentUrl.startsWith('http://') || attachmentUrl.startsWith('https://')) {
    return attachmentUrl;
  }
  const baseUrl = await getBaseUrl();
  return `${baseUrl}${attachmentUrl.startsWith('/') ? '' : '/'}${attachmentUrl}`;
}

/**
 * Quick dashboard summary stats.
 */
export interface DashboardStats {
  totalFiles: number;
  unreadNotifications: number;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  let totalFiles = 0;
  let unreadNotifications = 0;

  try {
    const stats = await api.get<Array<{ fileCount: number | string }>>('/api/library/stats');
    if (Array.isArray(stats)) {
      totalFiles = stats.reduce((acc, curr) => acc + (Number(curr.fileCount) || 0), 0);
    }
  } catch {
    // Graceful fallback
  }

  try {
    const notifs = await api.get<{ count: number }>('/api/notifications/unread-count');
    unreadNotifications = Number(notifs.count) || 0;
  } catch {
    // Graceful fallback
  }

  return { totalFiles, unreadNotifications };
}
