import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { apiFetch } from '@/services/api';

export const PUSH_TOKEN_STORAGE_KEY = 'semester_library_expo_push_token';

// Central notification channels on Android
export const NOTIFICATION_CHANNELS = {
  CHAT: 'chat',
  ACADEMIC: 'academic',
  SOCIAL: 'social',
  NOTICES: 'notices',
} as const;

// Strict typing for incoming push notification data payloads adhering to production contract
export interface BaseNotificationData {
  eventId?: string;
  entityId?: string;
  actorId?: string;
  actorName?: string;
  groupKey?: string;
  collapseId?: string;
  createdAt?: string;
}

export interface ChatNotificationData extends BaseNotificationData {
  type: 'chat';
  chatGroupId?: string;
  realtimeEpoch?: number;
  subType?: 'message' | 'mention' | string;
  messageId?: number;
  groupId?: string;
  groupName?: string;
  count?: number;
  senders?: string[];
}

export interface MaterialNotificationData extends BaseNotificationData {
  type: 'material';
  fileId: number;
  materialId?: number;
  title?: string;
  subject?: string | null;
  semester?: string | null;
}

export interface MaterialBatchNotificationData extends BaseNotificationData {
  type: 'material_batch';
  batchId: string;
  materialCount?: number;
  fileIds?: number[];
  subject?: string | null;
  semester?: string | null;
  chapter?: string | null;
}

export interface PostNotificationData extends BaseNotificationData {
  type: 'post';
  postId: number;
}

export interface NoticeNotificationData extends BaseNotificationData {
  type: 'notice';
  noticeId: number;
  postId?: number;
}

export interface PostCommentNotificationData extends BaseNotificationData {
  type: 'post_comment';
  postId: number;
  commentId?: number;
}

export interface CommentReplyNotificationData extends BaseNotificationData {
  type: 'comment_reply';
  postId: number;
  commentId?: number;
  replyId?: number;
}

export interface CommentReactionNotificationData extends BaseNotificationData {
  type: 'comment_reaction';
  postId: number;
  commentId?: number;
  replyId?: number;
  reactionType?: string;
}

export interface RoutineNotificationData extends BaseNotificationData {
  type: 'routine' | 'routine_updated';
  semester?: number | string;
}

export interface PostReactionNotificationData extends BaseNotificationData {
  type: 'post_reaction';
  postId: number;
}

export interface GameInviteNotificationData extends BaseNotificationData {
  type: 'game_invite';
  gameType: string;
  invitationId: string;
  roomId: string;
  expiresAt?: string;
}

export interface InAppNotificationActor {
  studentId: string;
  name: string;
  avatarUrl?: string | null;
  role?: string;
}

export interface InAppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  entityType: string;
  entityId: string;
  secondaryEntityId?: string | null;
  deepLink: string;
  webPath: string;
  groupKey?: string | null;
  priority: string;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  isRead: boolean;
  isSeen: boolean;
  readAt?: string | null;
  seenAt?: string | null;
  actor?: InAppNotificationActor | null;
}

export type NotificationPayload =
  | ChatNotificationData
  | MaterialNotificationData
  | MaterialBatchNotificationData
  | PostNotificationData
  | NoticeNotificationData
  | PostCommentNotificationData
  | CommentReplyNotificationData
  | CommentReactionNotificationData
  | RoutineNotificationData
  | PostReactionNotificationData
  | GameInviteNotificationData
  | (BaseNotificationData & { type: string; [key: string]: any });

export interface NotificationPreferences {
  muteChat: boolean;
  notifyNotes: boolean;
  notifyPosts: boolean;
  notifyNotices: boolean;
  hideLockscreenPreview: boolean;
}

export interface AdvancedNotificationPreferences extends NotificationPreferences {
  deliveryMessages: 'push_inbox' | 'inbox_only' | 'off';
  deliveryActivity: 'push_inbox' | 'inbox_only' | 'off';
  deliveryAcademic: 'push_inbox' | 'inbox_only' | 'off';
  deliverySystem: 'push_inbox' | 'inbox_only' | 'off';
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  timezone: string;
}

// Centralized notification navigation state machine
let pendingNotificationDestination: NotificationPayload | null = null;
let isHandlingNotificationNavigation = false;
let notificationNavigationCompleted = false;
let lastHandledNotificationId: string | null = null;
let lastHandledTimestamp = 0;
let isChatScreenActive = false;
let navigationGeneration = 0;

export function setChatScreenActive(active: boolean): void {
  isChatScreenActive = active;
}

export function isNotificationNavigating(): boolean {
  return isHandlingNotificationNavigation || pendingNotificationDestination !== null;
}

export function hasNotificationNavigationCompleted(): boolean {
  return notificationNavigationCompleted;
}

export function resetNotificationNavigationState(): void {
  navigationGeneration++;
  isHandlingNotificationNavigation = false;
  notificationNavigationCompleted = false;
  pendingNotificationDestination = null;
  lastHandledNotificationId = null;
  lastHandledTimestamp = 0;
}

export function getPendingNotification(): NotificationPayload | null {
  return pendingNotificationDestination;
}

export function setPendingNotification(payload: NotificationPayload | null): void {
  pendingNotificationDestination = payload;
  if (payload) {
    isHandlingNotificationNavigation = true;
  }
}

export function consumePendingNotification(): NotificationPayload | null {
  const pending = pendingNotificationDestination;
  pendingNotificationDestination = null;
  return pending;
}

export function executePendingNotificationNavigation(isAuthenticated: boolean): void {
  const pending = consumePendingNotification();
  if (!pending) return;
  navigateFromNotification(pending, isAuthenticated);
}

/**
 * Configure default foreground notification behavior.
 * When the user is already inside the active chat screen, banner is suppressed to avoid redundant alerts.
 */
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification?.request?.content?.data as Record<string, any> | undefined;
    const isChat = data?.type === 'chat';

    if (isChat && isChatScreenActive) {
      // User is actively reading the chat in foreground; suppress intrusive heads-up banner and let Realtime UI handle it
      return {
        shouldShowBanner: false,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      };
    }

    return {
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    };
  },
});

/**
 * Sync server-side unread badge count to device icon.
 */
export async function syncAppBadge(count?: number): Promise<void> {
  try {
    if (typeof count === 'number') {
      await Notifications.setBadgeCountAsync(Math.max(0, count));
      return;
    }
    const res = await apiFetch('/api/notifications/unread-count');
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      if (typeof data.count === 'number') {
        await Notifications.setBadgeCountAsync(Math.max(0, data.count));
      }
    }
  } catch (err) {
    if (__DEV__) console.warn('[Push] Error syncing app badge count:', err);
  }
}

export async function clearAppBadge(): Promise<void> {
  try {
    await Notifications.setBadgeCountAsync(0);
  } catch (err) {
    if (__DEV__) console.warn('[Push] Error clearing app badge count:', err);
  }
}

/**
 * Configure Android notification channels programmatically.
 */
export async function configureNotificationChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;

  try {
    // 1. Group Chat (Importance: Default, normal sound, grouping enabled)
    await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNELS.CHAT, {
      name: 'Group Chat',
      description: 'Incoming messages from class group chat',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#000000',
      enableLights: true,
      enableVibrate: true,
    });

    // 2. Study Materials (Academic)
    await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNELS.ACADEMIC, {
      name: 'Study Materials',
      description: 'New notes and study materials shared for your semester',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#10B981',
      enableLights: true,
      enableVibrate: true,
    });

    // 3. Social / Feed Posts
    await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNELS.SOCIAL, {
      name: 'Feed Posts',
      description: 'New questions and discussions on campus feed',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 200, 200, 200],
      lightColor: '#8B5CF6',
      enableLights: true,
      enableVibrate: true,
    });

    // 4. Official Notices (Importance: High)
    await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNELS.NOTICES, {
      name: 'Official Notices',
      description: 'Urgent notices and administrative announcements',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 300, 200, 300],
      lightColor: '#EF4444',
      enableLights: true,
      enableVibrate: true,
    });

    // 5. Default Fallback Channel
    await Notifications.setNotificationChannelAsync('default', {
      name: 'General',
      description: 'General system notifications',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#000000',
      enableLights: true,
      enableVibrate: true,
    });

    if (__DEV__) {
      console.log('[Push] Android notification channels configured successfully');
    }
  } catch (err) {
    console.warn('[Push] Error configuring Android notification channels:', err);
  }
}

/**
 * Check and request notification permissions if needed.
 * Returns true if permission is granted.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus === 'granted') {
      if (__DEV__) console.log('[Push] permission granted');
      return true;
    } else {
      if (__DEV__) console.log('[Push] permission denied');
      return false;
    }
  } catch (err) {
    console.warn('[Push] Error requesting permissions:', err);
    return false;
  }
}

/**
 * Obtain EAS Project ID safely from Expo configuration.
 */
export function getEasProjectId(): string | null {
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as any).easConfig?.projectId;

  if (!projectId) {
    if (__DEV__) {
      console.warn('[Push] EAS project ID not found in Expo configuration');
    }
    return null;
  }
  return projectId;
}

/**
 * Retrieve current Expo Push Token for this device.
 */
export async function getExpoPushToken(): Promise<string | null> {
  // Physical device check
  if (!Device.isDevice) {
    if (__DEV__) {
      console.warn('[Push] Must use a physical device for Push Notifications. Simulators/emulators are skipped.');
    }
    return null;
  }

  const projectId = getEasProjectId();
  if (!projectId) return null;

  try {
    const tokenResult = await Notifications.getExpoPushTokenAsync({
      projectId,
    });
    if (tokenResult?.data) {
      if (__DEV__) {
        console.log('[Push] token acquired');
      }
      return tokenResult.data;
    }
  } catch (err: any) {
    if (__DEV__) {
      console.warn('[Push] Failed to acquire Expo push token:', err?.message || err);
    }
  }
  return null;
}

/**
 * Register push token with backend under current authenticated user.
 * Isolated so that any network or permission failure never blocks login.
 */
export async function registerPushToken(): Promise<string | null> {
  try {
    const hasPermission = await requestNotificationPermission();
    if (!hasPermission) {
      return null;
    }

    const token = await getExpoPushToken();
    if (!token) {
      return null;
    }

    // Configure notification channels on Android
    await configureNotificationChannels();

    const deviceName = Device.modelName || Device.deviceName || Platform.OS;

    // Send registration request to backend using active Bearer token
    // The backend extracts the studentId from req.user (Supabase JWT) - do NOT send studentId
    const res = await apiFetch('/api/notifications/device-token', {
      method: 'POST',
      body: JSON.stringify({
        expoPushToken: token,
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
        deviceName,
      }),
    });

    if (res.ok) {
      await SecureStore.setItemAsync(PUSH_TOKEN_STORAGE_KEY, token);
      if (__DEV__) {
        console.log('[Push] token registered successfully');
      }
      return token;
    } else {
      const errText = await res.text().catch(() => '');
      if (__DEV__) {
        console.warn(`[Push] backend registration returned status ${res.status}:`, errText);
      }
    }
  } catch (err: any) {
    if (__DEV__) {
      console.warn('[Push] registerPushToken failed gracefully:', err?.message || err);
    }
  }
  return null;
}

/**
 * Unregister device token before logging out.
 * Must be executed while the Supabase / mobile auth token is still valid.
 */
export async function unregisterPushToken(): Promise<void> {
  try {
    const storedToken = await SecureStore.getItemAsync(PUSH_TOKEN_STORAGE_KEY);
    if (storedToken) {
      try {
        await apiFetch('/api/notifications/device-token', {
          method: 'DELETE',
          body: JSON.stringify({
            expoPushToken: storedToken,
          }),
        });
        if (__DEV__) {
          console.log('[Push] token unregister completed on backend');
        }
      } catch (reqErr) {
        // Best-effort unregister: continue even if device offline or server unreachable
        if (__DEV__) {
          console.warn('[Push] token unregister failed on network (continuing logout):', reqErr);
        }
      } finally {
        await SecureStore.deleteItemAsync(PUSH_TOKEN_STORAGE_KEY).catch(() => {});
      }
    }
  } catch (err) {
    if (__DEV__) {
      console.warn('[Push] unregisterPushToken error:', err);
    }
  }
}

/**
 * Validate untrusted incoming push notification data against strict typed contract.
 */
export function parseNotificationData(raw: unknown): NotificationPayload | null {
  if (!raw || typeof raw !== 'object') return null;

  const data = raw as Record<string, any>;
  const type = data.type;

  if (type === 'chat') {
    const messageId = Number(data.messageId);
    return {
      type: 'chat',
      chatGroupId: typeof data.chatGroupId === 'string' ? data.chatGroupId : undefined,
      realtimeEpoch: Number(data.realtimeEpoch) || undefined,
      subType: data.subType ? String(data.subType) : undefined,
      eventId: data.eventId ? String(data.eventId) : undefined,
      entityId: data.entityId ? String(data.entityId) : undefined,
      messageId: Number.isSafeInteger(messageId) && messageId > 0 ? messageId : undefined,
      groupId: data.chatGroupId || undefined,
      groupName: data.groupName || 'Class conversation',
      count: Number(data.count) || 1,
      senders: Array.isArray(data.senders) ? data.senders : undefined,
      actorId: data.actorId ? String(data.actorId) : undefined,
      actorName: data.actorName ? String(data.actorName) : undefined,
      groupKey: data.chatGroupId ? `chat:${data.chatGroupId}` : 'unavailable-chat',
      collapseId: data.chatGroupId ? `chat:${data.chatGroupId}` : 'unavailable-chat',
    };
  }

  if (type === 'material') {
    const fileId = Number(data.fileId || data.materialId);
    if (Number.isFinite(fileId) && fileId > 0) {
      return {
        type: 'material',
        fileId,
        materialId: fileId,
        title: data.title ? String(data.title) : undefined,
        subject: data.subject ? String(data.subject) : null,
        semester: data.semester ? String(data.semester) : null,
        actorId: data.actorId ? String(data.actorId) : undefined,
        actorName: data.actorName ? String(data.actorName) : undefined,
        groupKey: data.groupKey,
        collapseId: data.collapseId,
      };
    }
  }

  if (type === 'material_batch') {
    const fileIds = Array.isArray(data.fileIds)
      ? data.fileIds.map((id: any) => Number(id)).filter((n: number) => Number.isFinite(n) && n > 0)
      : [];
    return {
      type: 'material_batch',
      batchId: String(data.batchId || data.eventId || ''),
      eventId: data.eventId ? String(data.eventId) : undefined,
      materialCount: Number(data.materialCount) || fileIds.length || 1,
      fileIds,
      subject: data.subject ? String(data.subject) : null,
      semester: data.semester ? String(data.semester) : null,
      chapter: data.chapter ? String(data.chapter) : null,
      actorId: data.actorId ? String(data.actorId) : undefined,
      actorName: data.actorName ? String(data.actorName) : undefined,
      groupKey: data.groupKey,
      collapseId: data.collapseId,
    };
  }

  if (type === 'post') {
    const postId = Number(data.postId);
    if (Number.isFinite(postId) && postId > 0) {
      return {
        type: 'post',
        postId,
        actorId: data.actorId ? String(data.actorId) : undefined,
        actorName: data.actorName ? String(data.actorName) : undefined,
        groupKey: data.groupKey,
        collapseId: data.collapseId,
      };
    }
  }

  if (type === 'notice') {
    const noticeId = Number(data.noticeId || data.postId);
    if (Number.isFinite(noticeId) && noticeId > 0) {
      return {
        type: 'notice',
        noticeId,
        postId: noticeId,
        actorId: data.actorId ? String(data.actorId) : undefined,
        actorName: data.actorName ? String(data.actorName) : undefined,
        groupKey: data.groupKey,
        collapseId: data.collapseId,
      };
    }
  }

  if (type === 'post_comment') {
    const postId = Number(data.postId);
    if (Number.isFinite(postId) && postId > 0) {
      const commentId = Number(data.commentId);
      return {
        type: 'post_comment',
        postId,
        commentId: Number.isFinite(commentId) && commentId > 0 ? commentId : undefined,
        actorId: data.actorId ? String(data.actorId) : undefined,
        actorName: data.actorName ? String(data.actorName) : undefined,
        groupKey: data.groupKey,
        collapseId: data.collapseId,
      };
    }
  }

  if (type === 'comment_reply') {
    const postId = Number(data.postId);
    if (Number.isFinite(postId) && postId > 0) {
      const commentId = Number(data.commentId);
      const replyId = Number(data.replyId);
      return {
        type: 'comment_reply',
        postId,
        commentId: Number.isFinite(commentId) && commentId > 0 ? commentId : undefined,
        replyId: Number.isFinite(replyId) && replyId > 0 ? replyId : undefined,
        actorId: data.actorId ? String(data.actorId) : undefined,
        actorName: data.actorName ? String(data.actorName) : undefined,
        groupKey: data.groupKey,
        collapseId: data.collapseId,
      };
    }
  }

  if (type === 'comment_reaction') {
    const postId = Number(data.postId);
    if (Number.isFinite(postId) && postId > 0) {
      const commentId = Number(data.commentId);
      const replyId = Number(data.replyId);
      return {
        type: 'comment_reaction',
        postId,
        commentId: Number.isFinite(commentId) && commentId > 0 ? commentId : undefined,
        replyId: Number.isFinite(replyId) && replyId > 0 ? replyId : undefined,
        reactionType: data.reactionType ? String(data.reactionType) : 'like',
        actorId: data.actorId ? String(data.actorId) : undefined,
        actorName: data.actorName ? String(data.actorName) : undefined,
        groupKey: data.groupKey,
        collapseId: data.collapseId,
      };
    }
  }

  if (type === 'post_reaction') {
    const postId = Number(data.postId || data.entityId);
    if (Number.isFinite(postId) && postId > 0) {
      return {
        type: 'post_reaction',
        postId,
        actorId: data.actorId ? String(data.actorId) : undefined,
        actorName: data.actorName ? String(data.actorName) : undefined,
        groupKey: data.groupKey,
        collapseId: data.collapseId,
      };
    }
  }

  if (type === 'routine' || type === 'routine_updated') {
    return {
      type: 'routine',
      semester: data.semester,
      actorId: data.actorId ? String(data.actorId) : undefined,
      actorName: data.actorName ? String(data.actorName) : undefined,
      groupKey: data.groupKey,
      collapseId: data.collapseId,
    };
  }

  if (type === 'official_notice') {
    const noticeId = Number(data.noticeId || data.postId || data.entityId);
    if (Number.isFinite(noticeId) && noticeId > 0) {
      return {
        type: 'notice',
        noticeId,
        postId: noticeId,
        actorId: data.actorId ? String(data.actorId) : undefined,
        actorName: data.actorName ? String(data.actorName) : undefined,
        groupKey: data.groupKey,
        collapseId: data.collapseId,
      };
    }
  }

  if (type === 'game_invite') {
    const gameType = typeof data.gameType === 'string' ? data.gameType.trim() : '';
    const invitationId = typeof data.invitationId === 'string' ? data.invitationId.trim() : '';
    const roomId = typeof data.roomId === 'string' ? data.roomId.trim().toUpperCase() : '';
    const expiresAt = typeof data.expiresAt === 'string' ? data.expiresAt.trim() : undefined;

    if (gameType === 'tic-tac-toe' && invitationId.length > 0 && /^[A-Z0-9]{4,16}$/.test(roomId)) {
      if (expiresAt) {
        const expTime = new Date(expiresAt).getTime();
        if (Number.isNaN(expTime) || expTime <= Date.now()) {
          if (__DEV__) {
            console.warn('[Push] game_invite payload is expired');
          }
          return null;
        }
      }

      return {
        type: 'game_invite',
        gameType,
        invitationId,
        roomId,
        expiresAt,
        actorId: data.actorId ? String(data.actorId) : undefined,
        actorName: data.actorName ? String(data.actorName) : undefined,
        groupKey: data.groupKey,
        collapseId: data.collapseId,
      };
    }
  }

  return null;
}

/**
 * Central notification tap router with duplicate navigation protection
 * and unauthenticated gating.
 */
export function navigateFromNotification(
  rawPayload: unknown,
  isAuthenticated: boolean,
  notificationIdentifier?: string
): void {
  const now = Date.now();
  // Duplicate navigation protection with 4000ms window
  if (
    notificationIdentifier &&
    lastHandledNotificationId === notificationIdentifier &&
    now - lastHandledTimestamp < 4000
  ) {
    if (__DEV__) {
      console.log('[Push] Duplicate notification tap ignored:', notificationIdentifier);
    }
    return;
  }

  const payload = parseNotificationData(rawPayload);
  if (!payload) {
    if (__DEV__) {
      console.warn('[Push] notification tapped with unknown or invalid payload:', rawPayload);
    }
    return;
  }

  if (notificationIdentifier) {
    lastHandledNotificationId = notificationIdentifier;
  }
  lastHandledTimestamp = now;

  // Claim navigation ownership IMMEDIATELY to prevent competing startup redirects
  isHandlingNotificationNavigation = true;

  if (__DEV__) {
    console.log('[Push] Centralized notification navigation triggered for:', payload.type, 'isAuthenticated:', isAuthenticated);
  }

  // If user is not yet logged in, store the pending destination and redirect to login
  if (!isAuthenticated) {
    if (__DEV__) {
      console.log('[Push] Stashing pending notification destination until login completes');
    }
    setPendingNotification(payload);
    router.replace('/login');
    return;
  }

  // Centralized route dispatcher.
  // Use router.push (not router.replace) so the user always has back navigation.
  // For cold-start / killed-app scenarios, we first ensure tabs are in the stack,
  // then push the deep-linked destination on top.
  try {
    const generation = ++navigationGeneration;
    const pushDestination = () => {
      if (generation !== navigationGeneration) return;
      switch (payload.type) {
        case 'chat':
          if (payload.messageId) {
            router.push({
              pathname: '/(tabs)/chat',
              params: { targetMessageId: String(payload.messageId), targetChatGroupId: payload.chatGroupId || '' },
            });
          } else {
            router.push('/(tabs)/chat');
          }
          break;

        case 'material':
          router.push(`/material/${payload.fileId}`);
          break;

        case 'material_batch':
          if (payload.fileIds && payload.fileIds.length > 0) {
            router.push(`/material/${payload.fileIds[0]}`);
          } else {
            router.push('/(tabs)/library');
          }
          break;

        case 'post':
        case 'post_reaction':
          // Navigate to dedicated post detail page
          router.push(`/post/${payload.postId}`);
          break;

        case 'notice':
          // Navigate to dedicated notice detail page
          router.push(`/notice/${payload.noticeId}`);
          break;

        case 'routine':
        case 'routine_updated':
          router.push('/routine' as any);
          break;

        case 'post_comment':
        case 'comment_reply':
        case 'comment_reaction': {
          const params: { id: number; commentId?: string; replyId?: string } = { id: payload.postId };
          if (payload.commentId) params.commentId = String(payload.commentId);
          if ('replyId' in payload && payload.replyId) params.replyId = String(payload.replyId);
          router.push({
            pathname: '/post/[id]',
            params,
          });
          break;
        }

        case 'game_invite':
          router.push({
            pathname: '/games/tic-tac-toe',
            params: {
              invite: payload.invitationId,
              room: payload.roomId,
              autoJoin: '1',
            },
          });
          break;

        default:
          router.push('/(tabs)');
          break;
      }
    };

    // Determine if this is a tab destination (chat, library) or a stack screen
    const isTabDestination =
      payload.type === 'chat' ||
      (payload.type === 'material_batch' && (!payload.fileIds || payload.fileIds.length === 0));

    if (isTabDestination) {
      // For tab destinations, use replace to land directly on the tab
      switch (payload.type) {
        case 'chat':
          if (payload.messageId) {
            router.replace({
              pathname: '/(tabs)/chat',
              params: { targetMessageId: String(payload.messageId), targetChatGroupId: payload.chatGroupId || '' },
            });
          } else {
            router.replace('/(tabs)/chat');
          }
          break;
        default:
          router.replace('/(tabs)/library');
          break;
      }
    } else {
      // For stack screens (post, notice, material, etc.), ensure tabs are in the
      // back stack first, then push the destination on top.
      // This guarantees the user can press Back to reach the home/tabs screen.
      router.replace('/(tabs)');
      setTimeout(() => {
        pushDestination();
      }, 100);
    }

    notificationNavigationCompleted = true;
    isHandlingNotificationNavigation = false;
  } catch (navErr) {
    console.warn('[Push] Navigation error from notification tap:', navErr);
    try {
      router.replace('/(tabs)');
    } catch {}
    isHandlingNotificationNavigation = false;
  }
}

/**
 * Fetch student notification preferences from backend.
 */
export async function getNotificationPreferences(): Promise<NotificationPreferences | null> {
  try {
    const res = await apiFetch('/api/notifications/preferences');
    if (res.ok) {
      const data = await res.json();
      if (data.preferences) {
        return {
          muteChat: Boolean(data.preferences.muteChat),
          notifyNotes: data.preferences.notifyNotes !== false,
          notifyPosts: data.preferences.notifyPosts !== false,
          notifyNotices: data.preferences.notifyNotices !== false,
          hideLockscreenPreview: Boolean(data.preferences.hideLockscreenPreview),
        };
      }
    }
  } catch (err) {
    if (__DEV__) {
      console.warn('[Push] Failed to fetch notification preferences:', err);
    }
  }
  return null;
}

/**
 * Update student notification preferences on backend.
 */
export async function updateNotificationPreferences(
  prefs: Partial<NotificationPreferences>
): Promise<{ success: boolean; preferences?: NotificationPreferences; error?: string }> {
  try {
    const res = await apiFetch('/api/notifications/preferences', {
      method: 'PUT',
      body: JSON.stringify(prefs),
    });
    if (res.ok) {
      const data = await res.json();
      return {
        success: true,
        preferences: data.preferences,
      };
    } else {
      const err = await res.json().catch(() => ({}));
      return {
        success: false,
        error: err.message || 'Failed to update preferences',
      };
    }
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Network error updating notification preferences',
    };
  }
}

export interface FetchInAppNotificationsParams {
  tab?: 'all' | 'unread' | 'mentions';
  cursor?: string | null;
  limit?: number;
}

export interface FetchInAppNotificationsResponse {
  notifications: InAppNotification[];
  nextCursor: string | null;
  unseenCount: number;
}

/**
 * Fetch in-app notifications inbox with cursor-based pagination and tab filtering.
 */
export async function fetchInAppNotifications(
  params: FetchInAppNotificationsParams = {}
): Promise<FetchInAppNotificationsResponse> {
  const query = new URLSearchParams();
  if (params.tab) query.set('tab', params.tab);
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.limit) query.set('limit', String(params.limit));

  const url = `/api/notifications${query.toString() ? `?${query.toString()}` : ''}`;
  const res = await apiFetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch notifications: ${res.status}`);
  }
  const data = await res.json();
  return {
    notifications: Array.isArray(data.notifications) ? data.notifications : [],
    nextCursor: data.nextCursor || null,
    unseenCount: Number(data.unseenCount) || 0,
  };
}

/**
 * Fetch current unseen notification count for badge.
 */
export async function fetchUnseenCount(): Promise<number> {
  try {
    const res = await apiFetch('/api/notifications/unread-count');
    if (res.ok) {
      const data = await res.json();
      return Number(data.count) || 0;
    }
  } catch (err) {
    if (__DEV__) console.warn('[Notifications] Failed to fetch unseen count:', err);
  }
  return 0;
}

/**
 * Mark all incoming notifications as seen (clears bell badge count).
 */
export async function markNotificationSeen(): Promise<void> {
  try {
    await apiFetch('/api/notifications/seen', { method: 'POST' });
  } catch (err) {
    if (__DEV__) console.warn('[Notifications] Failed to mark notifications seen:', err);
  }
}

/**
 * Mark a single notification as read.
 */
export async function markNotificationRead(id: string): Promise<boolean> {
  try {
    const res = await apiFetch(`/api/notifications/${id}/read`, { method: 'POST' });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Mark a single notification as unread.
 */
export async function markNotificationUnread(id: string): Promise<boolean> {
  try {
    const res = await apiFetch(`/api/notifications/${id}/unread`, { method: 'POST' });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Mark all user notifications as read.
 */
export async function markAllNotificationsRead(): Promise<boolean> {
  try {
    const res = await apiFetch('/api/notifications/read-all', { method: 'POST' });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Soft-delete / hide a notification from the user's inbox.
 */
export async function hideInAppNotification(id: string): Promise<boolean> {
  try {
    const res = await apiFetch(`/api/notifications/${id}/hide`, { method: 'POST' });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Fetch advanced notification preferences with delivery channels & quiet hours.
 */
export async function getAdvancedPreferences(): Promise<AdvancedNotificationPreferences | null> {
  try {
    const res = await apiFetch('/api/notifications/preferences');
    if (res.ok) {
      const data = await res.json();
      if (data.preferences) {
        return {
          muteChat: Boolean(data.preferences.muteChat),
          notifyNotes: data.preferences.notifyNotes !== false,
          notifyPosts: data.preferences.notifyPosts !== false,
          notifyNotices: data.preferences.notifyNotices !== false,
          hideLockscreenPreview: Boolean(data.preferences.hideLockscreenPreview),
          deliveryMessages: data.preferences.deliveryMessages || 'push_inbox',
          deliveryActivity: data.preferences.deliveryActivity || 'push_inbox',
          deliveryAcademic: data.preferences.deliveryAcademic || 'push_inbox',
          deliverySystem: data.preferences.deliverySystem || 'push_inbox',
          quietHoursEnabled: Boolean(data.preferences.quietHoursEnabled),
          quietHoursStart: data.preferences.quietHoursStart || '22:30',
          quietHoursEnd: data.preferences.quietHoursEnd || '07:00',
          timezone: data.preferences.timezone || 'Asia/Kathmandu',
        };
      }
    }
  } catch (err) {
    if (__DEV__) console.warn('[Notifications] Failed to fetch advanced preferences:', err);
  }
  return null;
}

/**
 * Update advanced notification preferences.
 */
export async function updateAdvancedPreferences(
  prefs: Partial<AdvancedNotificationPreferences>
): Promise<{ success: boolean; preferences?: AdvancedNotificationPreferences; error?: string }> {
  try {
    const res = await apiFetch('/api/notifications/preferences', {
      method: 'PUT',
      body: JSON.stringify(prefs),
    });
    if (res.ok) {
      const data = await res.json();
      return { success: true, preferences: data.preferences };
    } else {
      const err = await res.json().catch(() => ({}));
      return { success: false, error: err.message || 'Failed to update preferences' };
    }
  } catch (err: any) {
    return { success: false, error: err.message || 'Network error' };
  }
}

/**
 * Navigate to target destination from an in-app notification tap.
 */
export function navigateToNotificationTarget(notification: InAppNotification): void {
  // A newer inbox tap supersedes any delayed push-notification navigation.
  navigationGeneration++;
  try {
    const { deepLink, entityType, entityId, secondaryEntityId, type } = notification;

    // 1. If explicit deepLink is provided, attempt deep link mapping
    if (deepLink) {
      if (deepLink.startsWith('/post/')) {
        const parts = deepLink.replace('/post/', '').split('?');
        const postId = Number(parts[0]);
        const search = new URLSearchParams(parts[1] || '');
        const commentId = search.get('commentId') || undefined;
        const replyId = search.get('replyId') || undefined;
        if (postId) {
          router.push({
            pathname: '/post/[id]',
            params: { id: postId, ...(commentId ? { commentId } : {}), ...(replyId ? { replyId } : {}) },
          });
          return;
        }
      } else if (deepLink.startsWith('/notice/')) {
        const noticeId = deepLink.replace('/notice/', '');
        router.push(`/notice/${noticeId}` as any);
        return;
      } else if (deepLink.startsWith('/material/')) {
        const materialId = deepLink.replace('/material/', '');
        router.push(`/material/${materialId}` as any);
        return;
      } else if (deepLink.startsWith('/routine')) {
        router.push('/routine' as any);
        return;
      } else if (deepLink.startsWith('/chat')) {
        const params = new URLSearchParams(deepLink.split('?')[1] || '');
        navigateFromNotification({
          type: 'chat',
          chatGroupId: params.get('chatGroupId') || params.get('targetChatGroupId') || notification.metadata?.chatGroupId,
          messageId: params.get('messageId') || params.get('targetMessageId') || notification.metadata?.messageId,
        }, true);
        return;
      }
    }

    // 2. Fallback based on entityType / type
    if (entityType === 'post' || type.startsWith('post_') || type.startsWith('comment_')) {
      const postId = Number(entityId);
      if (postId) {
        router.push({
          pathname: '/post/[id]',
          params: {
            id: postId,
            ...(secondaryEntityId ? { commentId: secondaryEntityId } : {}),
          },
        });
        return;
      }
    }

    if (entityType === 'notice' || type === 'official_notice' || type === 'notice') {
      router.push(`/notice/${entityId}` as any);
      return;
    }

    if (entityType === 'material' || type === 'material_uploaded' || type === 'material') {
      router.push(`/material/${entityId}` as any);
      return;
    }

    if (entityType === 'routine' || type === 'routine_updated' || type === 'routine') {
      router.push('/routine' as any);
      return;
    }

    if (entityType === 'chat' || type === 'chat_message' || type === 'chat') {
      navigateFromNotification({
        type: 'chat',
        chatGroupId: notification.metadata?.chatGroupId,
        messageId: notification.metadata?.messageId || secondaryEntityId,
      }, true);
      return;
    }

    // Default: Go to home
    router.push('/(tabs)');
  } catch (err) {
    if (__DEV__) console.warn('[Notifications] Navigation error:', err);
    router.push('/(tabs)');
  }
}
