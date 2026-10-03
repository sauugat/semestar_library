import { api, apiFetch, ApiError, getBaseUrl } from './api';
import { LibraryFile, toggleFileLike } from './library';
import { normalizeUploadFile, validateFileSize, RawFileAsset } from '../utils/file-upload';

export type { LibraryFile };
export { toggleFileLike };

export const MAX_ATTACHMENT_BYTES_PER_FILE = 4 * 1024 * 1024; // 4.0 MB per attachment (stays below Vercel request ceiling)
export const MAX_POST_ATTACHMENT_BYTES = MAX_ATTACHMENT_BYTES_PER_FILE; // Alias for backward compatibility

export function formatAttachmentBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface UploadedAttachment {
  url: string;
  filename?: string;
  media_type: 'image' | 'file';
  mime_type?: string;
  file_name?: string | null;
  file_size?: number | null;
}

export interface PostMediaItem {
  id: number;
  post_id: number;
  media_type: 'image' | 'video' | 'file';
  type?: 'image' | 'video' | 'file';
  url: string;
  mime_type?: string | null;
  file_name?: string | null;
  file_size?: number | null;
  sort_order: number;
  created_at?: string;
}

export interface CreatePostParams {
  content?: string;
  type?: 'status' | 'assignment' | 'notice';
  imageUri?: string | null;
  image?: RawFileAsset | null;
  images?: RawFileAsset[];
  files?: RawFileAsset[];
  official?: boolean;
  attachments?: UploadedAttachment[];
}

export interface Post {
  id: number;
  user_id: string;
  content: string;
  type: 'status' | 'assignment' | 'notice';
  attachment_url: string | null;
  created_at: string;
  edited_at?: string | null;
  edited?: boolean;
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
  canEdit?: boolean;
  media?: PostMediaItem[];
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
  parentCommentId?: number | null;
  replyToUserId?: string | null;
  replyToUser?: {
    studentId: string;
    name: string;
  } | null;
  updatedAt?: string | null;
  edited?: boolean;
  isDeleted?: boolean;
  reactionCount?: number;
  reactedByMe?: boolean;
  replyCount?: number;
  replies?: PostComment[];
  canDelete?: boolean;
  canEdit?: boolean;
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
 * Fetch a single post or notice by ID with multi-tier resilient fallback.
 */
export async function getPostById(postId: number): Promise<Post> {
  const numericId = Number(postId);
  if (!numericId || isNaN(numericId)) {
    throw new ApiError('Invalid post ID', 400);
  }

  // Tier 1: Dedicated single-post endpoint
  try {
    const direct = await api.get<Post>(`/api/posts/${numericId}`);
    if (direct && Number(direct.id) === numericId) {
      return direct;
    }
  } catch (err: any) {
    if (__DEV__) {
      console.log(`[getPostById] Tier 1 GET /api/posts/${numericId} failed (${err?.status || err?.message}); trying Tier 2 cursor fallback...`);
    }
  }

  // Tier 2: Fetch descending cursor page around postId (compatible with all deployed backends)
  try {
    const pageRes = await api.get<PostsResponse>(`/api/posts?before=${numericId + 1}&limit=25`);
    const match = pageRes?.posts?.find((p) => Number(p.id) === numericId);
    if (match) {
      return match;
    }
  } catch (err) {
    if (__DEV__) {
      console.log('[getPostById] Tier 2 cursor fallback failed:', err);
    }
  }

  // Tier 3: Fetch notices specifically (in case it is categorized as notice)
  try {
    const noticeRes = await api.get<{ posts: Post[] } | Post[]>(`/api/posts?type=notice&limit=50`);
    const list: Post[] = Array.isArray((noticeRes as any)?.posts)
      ? (noticeRes as any).posts
      : Array.isArray(noticeRes)
      ? noticeRes
      : [];
    const match = list.find((p) => Number(p.id) === numericId);
    if (match) {
      return match;
    }
  } catch (err) {
    if (__DEV__) {
      console.log('[getPostById] Tier 3 notices fallback failed:', err);
    }
  }

  throw new ApiError('Post not found', 404);
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
  const res = await api.get<any>(`/api/posts/${postId}/comments`);
  return Array.isArray(res) ? res : (res?.comments || []);
}

/**
 * Add a comment or reply to a post.
 */
export async function addComment(
  postId: number,
  content: string,
  options?: {
    parentCommentId?: number | null;
    replyToUserId?: string | null;
  }
): Promise<{ comment: PostComment; comment_count: number; commentCount: number }> {
  return api.post<{ comment: PostComment; comment_count: number; commentCount: number }>(
    `/api/posts/${postId}/comments`,
    {
      content,
      parent_comment_id: options?.parentCommentId,
      reply_to_user_id: options?.replyToUserId,
    }
  );
}

/**
 * Edit an existing comment.
 */
export async function editComment(
  postId: number,
  commentId: number,
  content: string
): Promise<{ comment: PostComment; message: string }> {
  return api.put<{ comment: PostComment; message: string }>(
    `/api/posts/${postId}/comments/${commentId}`,
    { content }
  );
}

/**
 * Toggle like reaction on a comment or reply.
 */
export async function toggleCommentReaction(
  postId: number,
  commentId: number,
  reactionType: string = 'like'
): Promise<{ reacted: boolean; reaction_count: number; reactionCount: number }> {
  return api.post<{ reacted: boolean; reaction_count: number; reactionCount: number }>(
    `/api/posts/${postId}/comments/${commentId}/like`,
    { reaction_type: reactionType }
  );
}

/**
 * Fetch replies for a specific comment.
 */
export async function getCommentReplies(
  postId: number,
  commentId: number,
  limit: number = 50,
  offset: number = 0
): Promise<{ replies: PostComment[]; replyCount: number }> {
  return api.get<{ replies: PostComment[]; replyCount: number }>(
    `/api/posts/${postId}/comments/${commentId}/replies?limit=${limit}&offset=${offset}`
  );
}

/**
 * Delete a comment from a post.
 */
export async function deleteComment(
  postId: number,
  commentId: number
): Promise<{ message: string; comment_count: number; commentCount: number }> {
  return api.delete<{ message: string; comment_count: number; commentCount: number }>(
    `/api/posts/${postId}/comments/${commentId}`
  );
}

/**
 * Deletes a post by ID.
 */
export async function deletePost(postId: number): Promise<{ message: string }> {
  return api.delete<{ message: string }>(`/api/posts/${postId}`);
}

/**
 * Uploads a single post attachment (photo or document) independently.
 * Stays safely below Vercel's per-request limit.
 */
export async function uploadPostAttachment(
  file: RawFileAsset | { uri: string; name?: string; type?: string; size?: number; fileName?: string; mimeType?: string },
  onProgress?: (percent: number) => void
): Promise<UploadedAttachment> {
  const assetName = (file as any).name || (file as any).fileName || `post_${Date.now()}`;
  const assetMime = (file as any).type || (file as any).mimeType || 'application/octet-stream';
  const assetSize = (file as any).size || (file as any).fileSize;

  if (assetSize && assetSize > MAX_ATTACHMENT_BYTES_PER_FILE) {
    throw new ApiError(
      `File "${assetName}" exceeds 4 MB (${formatAttachmentBytes(assetSize)}). Photos and documents must be 4 MB or smaller. For larger study materials, upload them to the Library.`,
      413
    );
  }

  const formData = new FormData();
  formData.append('file', {
    uri: file.uri,
    name: assetName,
    type: assetMime,
  } as any);

  if (typeof XMLHttpRequest !== 'undefined' && onProgress) {
    const rawBaseUrl = await getBaseUrl();
    const baseUrl = (rawBaseUrl || '').replace(/\/+$/, '');
    const url = `${baseUrl}/api/posts/attachments`;

    return new Promise<UploadedAttachment>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      if (xhr.upload) {
        xhr.upload.onprogress = (evt) => {
          if (evt.lengthComputable && evt.total > 0) {
            const pct = Math.min(100, Math.round((evt.loaded / evt.total) * 100));
            onProgress(pct);
          }
        };
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            onProgress(100);
            resolve(data);
          } catch {
            reject(new ApiError('Invalid response from upload server', xhr.status));
          }
        } else {
          let msg = `Upload failed (HTTP ${xhr.status})`;
          try {
            const err = JSON.parse(xhr.responseText);
            if (err.message) msg = err.message;
          } catch {}
          reject(new ApiError(msg, xhr.status));
        }
      };

      xhr.onerror = () => {
        reject(new ApiError('Network error during file upload', 0));
      };

      xhr.ontimeout = () => {
        reject(new ApiError('Upload timed out', 408));
      };

      xhr.send(formData as any);
    });
  }

  const res = await apiFetch('/api/posts/attachments', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new ApiError(errBody.message || `Upload failed (HTTP ${res.status})`, res.status, errBody);
  }

  if (onProgress) onProgress(100);
  return res.json();
}

/**
 * Safely cleans up an unattached blob (e.g. if draft discarded or post creation fails).
 */
export async function deletePostAttachment(filenameOrUrl: string): Promise<boolean> {
  if (!filenameOrUrl) return false;
  const filename = filenameOrUrl.split('/').pop()?.split('?')[0] || filenameOrUrl;
  try {
    const res = await apiFetch(`/api/posts/attachments/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Creates a new post with text, optional attachments, and type.
 * When raw images or files are passed, uploads each independently before creating post via JSON.
 */
export async function createPost(params: CreatePostParams): Promise<Post> {
  let uploadedAttachments: UploadedAttachment[] = [];

  // If pre-uploaded attachments were provided, use them directly
  if (Array.isArray(params.attachments) && params.attachments.length > 0) {
    uploadedAttachments = params.attachments;
  } else {
    // Collect all raw image and file assets to upload
    const imagesToUpload = Array.isArray(params.images) && params.images.length > 0
      ? params.images
      : (params.image || params.imageUri ? [params.image || { uri: params.imageUri! }] : []);
    const filesToUpload = Array.isArray(params.files) ? params.files : [];

    if (imagesToUpload.length > 10) throw new ApiError('Maximum 10 images allowed per post.', 400);
    if (filesToUpload.length > 5) throw new ApiError('Maximum 5 files allowed per post.', 400);

    const newlyUploaded: UploadedAttachment[] = [];
    try {
      // Upload each attachment INDEPENDENTLY in separate requests
      for (const img of imagesToUpload) {
        if (img && img.uri) {
          const res = await uploadPostAttachment(img);
          newlyUploaded.push(res);
        }
      }
      for (const file of filesToUpload) {
        if (file && file.uri) {
          const res = await uploadPostAttachment(file);
          newlyUploaded.push(res);
        }
      }
      uploadedAttachments = newlyUploaded;
    } catch (uploadErr) {
      // If any upload fails, clean up already uploaded blobs safely
      for (const att of newlyUploaded) {
        if (att.filename || att.url) await deletePostAttachment(att.filename || att.url);
      }
      throw uploadErr;
    }
  }

  // Small JSON request to create the post
  try {
    const res = await apiFetch('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: (params.content || '').trim(),
        type: params.type || 'status',
        official: Boolean(params.official),
        attachments: uploadedAttachments,
      }),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new ApiError(errBody.message || `Failed to create post (HTTP ${res.status})`, res.status, errBody);
    }

    return res.json();
  } catch (createErr) {
    // If post creation fails, clean up newly uploaded blobs safely (Requirement 8)
    for (const att of uploadedAttachments) {
      if (att.filename || att.url) await deletePostAttachment(att.filename || att.url);
    }
    throw createErr;
  }
}

export interface UpdatePostParams {
  content?: string;
  keepMediaUrls?: string[];
  keepMediaIds?: number[];
  newImages?: (RawFileAsset | { uri: string; name?: string; type?: string; size?: number; fileName?: string; mimeType?: string })[];
  newFiles?: (RawFileAsset | { uri: string; name?: string; type?: string; size?: number; fileName?: string; mimeType?: string })[];
  newAttachments?: UploadedAttachment[];
}

/**
 * Updates an existing post (caption, keeping/removing existing images/files, adding new images/files).
 * Retained attachments are NOT re-uploaded. Only new attachments are uploaded independently.
 */
export async function updatePost(postId: number, params: UpdatePostParams): Promise<Post> {
  let uploadedAttachments: UploadedAttachment[] = [];

  if (Array.isArray(params.newAttachments) && params.newAttachments.length > 0) {
    uploadedAttachments = params.newAttachments;
  } else {
    const imagesToUpload = Array.isArray(params.newImages) ? params.newImages : [];
    const filesToUpload = Array.isArray(params.newFiles) ? params.newFiles : [];

    const newlyUploaded: UploadedAttachment[] = [];
    try {
      // Upload each new attachment INDEPENDENTLY in separate requests
      for (const img of imagesToUpload) {
        if (img && img.uri) {
          const res = await uploadPostAttachment(img);
          newlyUploaded.push(res);
        }
      }
      for (const file of filesToUpload) {
        if (file && file.uri) {
          const res = await uploadPostAttachment(file);
          newlyUploaded.push(res);
        }
      }
      uploadedAttachments = newlyUploaded;
    } catch (uploadErr) {
      for (const att of newlyUploaded) {
        if (att.filename || att.url) await deletePostAttachment(att.filename || att.url);
      }
      throw uploadErr;
    }
  }

  // Small JSON request to update the post (retained media is NOT re-uploaded!)
  try {
    const res = await apiFetch(`/api/posts/${postId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: params.content !== undefined ? params.content.trim() : undefined,
        keepMediaUrls: params.keepMediaUrls,
        keepMediaIds: params.keepMediaIds,
        newAttachments: uploadedAttachments,
      }),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new ApiError(errBody.message || `Failed to update post (HTTP ${res.status})`, res.status, errBody);
    }

    return res.json();
  } catch (updateErr) {
    // If update fails, clean up newly uploaded blobs safely (Requirement 8)
    for (const att of uploadedAttachments) {
      if (att.filename || att.url) await deletePostAttachment(att.filename || att.url);
    }
    throw updateErr;
  }
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
