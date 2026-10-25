import React, { createContext, useContext, useState, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';
import { router } from 'expo-router';
import { clearChatDb } from '@/services/chat-db';
import { disconnectChatRealtime } from '@/services/chat-realtime';
import { clearAllDmCache } from '@/services/dm-db';
import { disconnectAllDmRealtime } from '@/services/dm-realtime';
import { clearCachedKyanaMessages } from '@/services/kyana-db';
import { invalidateChatSession, beginChatSession } from '@/services/chat-session';
import { clearAppQueryCache } from '@/services/query-client';
import { getAutoDetectedServerUrl, getBaseUrl, isTrustedServerUrl, DEFAULT_SERVER_URL, addSuspensionListener } from '@/services/api';
import {
  registerPushToken,
  unregisterPushToken,
  consumePendingNotification,
  navigateFromNotification,
  resetNotificationNavigationState,
} from '@/services/notifications';

const TOKEN_KEY = 'semester_library_mobile_token';
const USER_KEY = 'semester_library_mobile_user';
const SERVER_URL_KEY = 'semester_library_server_url';

export interface StudentUser {
  studentId: string;
  username?: string | null;
  name: string;
  role: string;
  isAdmin?: boolean;
  isCR?: boolean;
  avatarUrl?: string | null;
  coverUrl?: string | null;
  coverPosition?: string | null;
  bio?: string;
  department?: string;
  semester?: string;
  gender?: string | null;
  email?: string | null;
  githubUrl?: string;
  linkedinUrl?: string;
  verificationStatus?: string;
  canCreateAssignments?: boolean;
  subjects?: Array<{ id: string; code: string; title: string; semester?: number }>;
  stats?: {
    filesCount: number;
    postsCount?: number;
    photosCount?: number;
    assignmentsCount?: number;
    likesReceived: number;
    followersCount: number;
    followingCount: number;
  };
}

export interface RegisterPayload {
  fullName: string;
  studentId?: string;
  username: string;
  email: string;
  department: string;
  semester: string;
  gender?: string;
  password?: string;
  confirmPassword?: string;
  supabaseToken?: string;
}

interface AuthContextType {
  user: StudentUser | null;
  token: string | null;
  serverUrl: string;
  isLoading: boolean;
  login: (identifier: string, password: string, customUrl?: string) => Promise<{ success: boolean; error?: string; code?: string; onboardingRequired?: boolean; onboardingToken?: string; state?: any }>;
  register: (payload: RegisterPayload, customUrl?: string) => Promise<{ success: boolean; message?: string; error?: string; user?: StudentUser; mobileToken?: string }>;
  forgotPassword: (identifier: string, customUrl?: string) => Promise<{ success: boolean; message?: string; error?: string }>;
  resendVerification: (identifier: string, customUrl?: string) => Promise<{ success: boolean; message?: string; error?: string }>;
  refreshProfile: () => Promise<StudentUser | null>;
  updateProfile: (data: Partial<StudentUser>) => Promise<{ success: boolean; profile?: StudentUser; error?: string }>;
  logout: () => Promise<void>;
  updateServerUrl: (url: string) => Promise<void>;
  setSession: (token: string, user: StudentUser) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<StudentUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState<string>(DEFAULT_SERVER_URL);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Synchronize React Native auth state with account suspension notifications
  useEffect(() => {
    const unsub = addSuspensionListener(async (msg) => {
      await unregisterPushToken().catch(() => {});
      await SecureStore.deleteItemAsync(TOKEN_KEY);
      await SecureStore.deleteItemAsync(USER_KEY);
      invalidateChatSession();
      void disconnectChatRealtime();
      disconnectAllDmRealtime();
      await clearChatDb({ preservePending: true });
      await clearAllDmCache();
      await clearCachedKyanaMessages();
      await clearAppQueryCache();
      setToken(null);
      setUser(null);
    });
    return unsub;
  }, []);

  // Initialize auth state on app load without blocking first render
  useEffect(() => {
    let isMounted = true;

    async function initializeAuth() {
      try {
        // 1. In production (!__DEV__), purge stored server URL key and force getBaseUrl()
        if (!__DEV__) {
          await SecureStore.deleteItemAsync(SERVER_URL_KEY).catch(() => {});
        }
        const activeUrl = await getBaseUrl();
        if (isMounted) setServerUrl(activeUrl);

        // 2. Load stored token & cached user profile
        const storedToken = await SecureStore.getItemAsync(TOKEN_KEY);
        const storedUserJson = await SecureStore.getItemAsync(USER_KEY);

        if (storedToken) {
          let cachedUser: StudentUser | null = null;
          if (storedUserJson) {
            try {
              cachedUser = JSON.parse(storedUserJson);
            } catch {}
          }

          if (isMounted) {
            setToken(storedToken);
            if (cachedUser) {
              setUser(cachedUser);
              beginChatSession(activeUrl, cachedUser.studentId, storedToken);
            }
            // CRITICAL: Unblock UI render immediately with cached credentials (0ms delay)
            setIsLoading(false);
          }

          // Register / sync push token in background when session is restored
          void registerPushToken();

          // 3. Verify token against /api/me in the background with timeout
          void (async () => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 10000);
            try {
              const res = await fetch(`${activeUrl}/api/me`, {
                headers: {
                  Authorization: `Bearer ${storedToken}`,
                  Accept: 'application/json',
                },
                signal: controller.signal,
              });
              clearTimeout(timer);

              if (res.status === 200) {
                const freshUser: StudentUser = await res.json();
                const roleChanged = cachedUser && (cachedUser.role !== freshUser.role || cachedUser.isCR !== freshUser.isCR);
                if (isMounted) {
                  setUser(freshUser);
                  beginChatSession(activeUrl, freshUser.studentId, storedToken);
                }
                await SecureStore.setItemAsync(USER_KEY, JSON.stringify(freshUser));
                if (roleChanged) {
                  await clearAppQueryCache();
                }
              } else if (res.status === 401 || res.status === 403) {
                const errData = await res.json().catch(() => ({}));
                const isSuspended = res.status === 403 && (errData.error === 'ACCOUNT_SUSPENDED' || errData.code === 'ACCOUNT_SUSPENDED');
                // Token invalid, revoked, or account suspended - unregister push token first
                await unregisterPushToken().catch(() => {});
                await SecureStore.deleteItemAsync(TOKEN_KEY);
                await SecureStore.deleteItemAsync(USER_KEY);
                invalidateChatSession();
                void disconnectChatRealtime();
                disconnectAllDmRealtime();
                await clearChatDb({ preservePending: true });
                await clearAllDmCache();
                await clearCachedKyanaMessages();
                await clearAppQueryCache();
                if (isMounted) {
                  setToken(null);
                  setUser(null);
                  router.replace({
                    pathname: '/login' as any,
                    params: isSuspended ? { suspensionMessage: errData.message || 'Your account has been suspended by an administrator.' } : {},
                  });
                }
              }
            } catch {
              // Network error or timeout: maintain cached session safely
              clearTimeout(timer);
            }
          })();
          return;
        }
      } catch (err) {
        console.warn('Auth initialization error:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    initializeAuth();
    return () => {
      isMounted = false;
    };
  }, []);

  const login = async (identifier: string, password: string, customUrl?: string) => {
    const targetUrl = customUrl ? customUrl.trim() : serverUrl;
    try {
      const res = await fetch(`${targetUrl}/api/mobile/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          identifier: identifier.trim(),
          studentId: identifier.trim(),
          password,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.status === 200 && data.onboardingRequired) {
        return {
          success: false,
          onboardingRequired: true,
          onboardingToken: data.onboardingToken,
          state: data.state,
        };
      }

      if (res.status === 200 && data.token) {
        invalidateChatSession();
        disconnectChatRealtime();
        disconnectAllDmRealtime();
        await clearChatDb();
        await clearAllDmCache();
        await clearCachedKyanaMessages();
        await clearAppQueryCache();
        await SecureStore.setItemAsync(TOKEN_KEY, data.token);
        if (data.user) {
          await SecureStore.setItemAsync(USER_KEY, JSON.stringify(data.user));
        }
        if (customUrl && customUrl !== serverUrl) {
          await updateServerUrl(customUrl);
        }
        setToken(data.token);
        setUser(data.user);


        // Register push token with backend under this newly authenticated student
        void registerPushToken();

        // Check if user tapped a notification while logged out
        const pendingNotification = consumePendingNotification();
        if (pendingNotification) {
          navigateFromNotification(pendingNotification, true);
        } else {
          router.replace('/(tabs)');
        }
        return { success: true };
      } else {
        return {
          success: false,
          code: data.code,
          error: data.message || `Login failed (HTTP ${res.status})`,
        };
      }
    } catch (err: any) {
      return {
        success: false,
        error: __DEV__
          ? `Could not connect to ${targetUrl}. Ensure your phone is on the same Wi-Fi.`
          : 'Unable to connect to Semester Library. Check your internet connection and try again.',
      };
    }
  };

  const register = async (payload: RegisterPayload, customUrl?: string) => {
    const targetUrl = customUrl ? customUrl.trim() : serverUrl;
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
      if (payload.supabaseToken) {
        headers['Authorization'] = `Bearer ${payload.supabaseToken}`;
      }

      const res = await fetch(`${targetUrl}/api/auth/register`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        if (data.mobileToken && data.user) {
          await setSession(data.mobileToken, data.user);
        }

        return {
          success: true,
          message: data.message || 'Account created successfully!',
          user: data.user,
          mobileToken: data.mobileToken,
        };
      } else {
        return {
          success: false,
          error: data.message || `Registration failed (HTTP ${res.status})`,
        };
      }
    } catch (err: any) {
      return {
        success: false,
        error: __DEV__
          ? `Could not connect to ${targetUrl}. Ensure your phone is on the same Wi-Fi.`
          : 'Unable to connect to Semester Library. Check your internet connection and try again.',
      };
    }
  };

  const forgotPassword = async (identifier: string, customUrl?: string) => {
    const targetUrl = customUrl ? customUrl.trim() : serverUrl;
    try {
      const res = await fetch(`${targetUrl}/api/auth/forgot-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ identifier: identifier.trim() }),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        return {
          success: true,
          message: data.message || 'Password reset link sent to your email address.',
        };
      } else {
        return {
          success: false,
          error: data.message || 'Failed to send password reset link.',
        };
      }
    } catch (err: any) {
      return {
        success: false,
        error: __DEV__
          ? `Could not connect to ${targetUrl}. Ensure your phone is on the same Wi-Fi.`
          : 'Unable to connect to Semester Library. Check your internet connection and try again.',
      };
    }
  };

  const resendVerification = async (identifier: string, customUrl?: string) => {
    const targetUrl = customUrl ? customUrl.trim() : serverUrl;
    try {
      const res = await fetch(`${targetUrl}/api/auth/resend-verification`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ identifier: identifier.trim() }),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        return {
          success: true,
          message: data.message || 'Verification link sent to your email address.',
        };
      } else {
        return {
          success: false,
          error: data.message || 'Failed to resend verification email.',
        };
      }
    } catch (err: any) {
      return {
        success: false,
        error: __DEV__
          ? `Could not connect to ${targetUrl}. Ensure your phone is on the same Wi-Fi.`
          : 'Unable to connect to Semester Library. Check your internet connection and try again.',
      };
    }
  };

  const refreshProfile = async (): Promise<StudentUser | null> => {
    if (!token) return null;
    try {
      const res = await fetch(`${serverUrl}/api/profile`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });

      if (res.ok) {
        const fresh: StudentUser = await res.json();
        const roleChanged = user && (user.role !== fresh.role || user.isCR !== fresh.isCR);
        setUser(fresh);
        await SecureStore.setItemAsync(USER_KEY, JSON.stringify(fresh));
        if (roleChanged) {
          await clearAppQueryCache();
        }
        return fresh;
      }
    } catch (err) {
      console.warn('Refresh profile error:', err);
    }
    return user;
  };

  const updateProfile = async (data: Partial<StudentUser>) => {
    if (!token) return { success: false, error: 'Not authenticated' };
    try {
      const res = await fetch(`${serverUrl}/api/profile/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        body: JSON.stringify(data),
      });

      const json = await res.json().catch(() => ({}));
      if (res.ok && json.profile) {
        setUser(json.profile);
        await SecureStore.setItemAsync(USER_KEY, JSON.stringify(json.profile));
        return { success: true, profile: json.profile };
      } else {
        return { success: false, error: json.message || 'Failed to update profile' };
      }
    } catch (err: any) {
      return { success: false, error: 'Network error while updating profile' };
    }
  };

  const logout = async () => {
    invalidateChatSession();
    resetNotificationNavigationState();
    void disconnectChatRealtime();
    disconnectAllDmRealtime();
    try {
      // 1. Unregister Expo Push Token with backend while Supabase authentication is STILL valid
      await unregisterPushToken().catch((pushErr) => {
        console.warn('[Push] Push token unregistration on logout failed:', pushErr);
      });

      // 2. Invalidate server-side session
      if (token) {
        await fetch(`${serverUrl}/api/mobile/logout`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
        }).catch(() => {});
      }
      await SecureStore.deleteItemAsync(TOKEN_KEY);
      await SecureStore.deleteItemAsync(USER_KEY);
      // Clean up local chat database and query caches so next user sees fresh data
      invalidateChatSession();
      await disconnectChatRealtime();
      disconnectAllDmRealtime();
      await clearChatDb();
      await clearAllDmCache();
      await clearCachedKyanaMessages();
      await clearAppQueryCache();
      resetNotificationNavigationState();
    } catch (e) {
      console.warn('Logout error:', e);
    } finally {
      setToken(null);
      setUser(null);
      router.replace('/login');
    }
  };

  const updateServerUrl = async (newUrl: string) => {
    if (!__DEV__) {
      // In production builds, custom server URLs are strictly ignored and prohibited
      await SecureStore.deleteItemAsync(SERVER_URL_KEY).catch(() => {});
      return;
    }
    const sanitized = newUrl.trim().replace(/\/+$/, '');
    if (!isTrustedServerUrl(sanitized)) {
      throw new Error(`Untrusted server URL: ${sanitized}. Must be an approved local address or *.vercel.app deployment.`);
    }

    // Isolate environment state: purge session, tokens, and caches so environments do not mix
    disconnectChatRealtime();
    disconnectAllDmRealtime();
    invalidateChatSession();
    clearAppQueryCache();
    await Promise.allSettled([
      SecureStore.deleteItemAsync(TOKEN_KEY),
      SecureStore.deleteItemAsync(USER_KEY),
      clearChatDb(),
      clearAllDmCache(),
      clearCachedKyanaMessages(),
      SecureStore.setItemAsync(SERVER_URL_KEY, sanitized),
    ]);

    setServerUrl(sanitized);
    setToken(null);
    setUser(null);
  };

  const setSession = async (newToken: string, newUser: StudentUser) => {
    invalidateChatSession();
    disconnectChatRealtime();
    disconnectAllDmRealtime();
    await clearChatDb();
    await clearAllDmCache();
    await clearCachedKyanaMessages();
    await clearAppQueryCache();
    await SecureStore.setItemAsync(TOKEN_KEY, newToken);
    if (newUser) {
      await SecureStore.setItemAsync(USER_KEY, JSON.stringify(newUser));
    }
    setToken(newToken);
    setUser(newUser);
    void registerPushToken();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        serverUrl,
        isLoading,
        login,
        register,
        forgotPassword,
        resendVerification,
        refreshProfile,
        updateProfile,
        logout,
        updateServerUrl,
        setSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
