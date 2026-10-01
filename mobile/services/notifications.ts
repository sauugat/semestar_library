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

export interface PostNotificationData extends BaseNotificationData {
  type: 'post';
  postId: number;
}

export interface NoticeNotificationData extends BaseNotificationData {
  type: 'notice';
  noticeId: number;
  postId?: number;
}

export type NotificationPayload =
  | ChatNotificationData
  | MaterialNotificationData
  | PostNotificationData
  | NoticeNotificationData;

export interface NotificationPreferences {
  muteChat: boolean;
  notifyNotes: boolean;
  notifyPosts: boolean;
  notifyNotices: boolean;
  hideLockscreenPreview: boolean;
}

// Centralized notification navigation state machine
let pendingNotificationDestination: NotificationPayload | null = null;
let isHandlingNotificationNavigation = false;
let notificationNavigationCompleted = false;
let lastHandledNotificationId: string | null = null;
let lastHandledTimestamp = 0;
let isChatScreenActive = false;

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
      eventId: data.eventId ? String(data.eventId) : undefined,
      entityId: data.entityId ? String(data.entityId) : undefined,
      messageId: Number.isFinite(messageId) ? messageId : undefined,
      groupId: data.groupId || 'bit',
      groupName: data.groupName || 'BIT Group Chat',
      count: Number(data.count) || 1,
      senders: Array.isArray(data.senders) ? data.senders : undefined,
      actorId: data.actorId ? String(data.actorId) : undefined,
      actorName: data.actorName ? String(data.actorName) : undefined,
      groupKey: data.groupKey || 'chat_group_bit',
      collapseId: data.collapseId || 'chat_group_bit',
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

  // Centralized route dispatcher using verified screen routes and router.replace
  // to ensure previous/splash route does not compete or trigger delayed redirects
  try {
    switch (payload.type) {
      case 'chat':
        router.replace('/(tabs)/chat');
        break;

      case 'material':
        router.replace(`/material/${payload.fileId}`);
        break;

      case 'post':
        // Navigate to home feed with highlighted postId (opens comments discussion)
        router.replace({
          pathname: '/(tabs)',
          params: { postId: String(payload.postId) },
        });
        break;

      case 'notice':
        // Navigate to dedicated notices screen targeting notice
        router.replace({
          pathname: '/notices',
          params: { id: String(payload.noticeId) },
        });
        break;

      default:
        router.replace('/(tabs)');
        break;
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
