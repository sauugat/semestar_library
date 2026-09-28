import React, { createContext, useContext, useState, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';
import { router } from 'expo-router';
import { clearChatDb } from '@/services/chat-db';
import { initChatRealtime, disconnectChatRealtime } from '@/services/chat-realtime';
import { clearAppQueryCache } from '@/services/query-client';
import { getAutoDetectedServerUrl, DEFAULT_SERVER_URL } from '@/services/api';
const TOKEN_KEY = 'semester_library_mobile_token';
const USER_KEY = 'semester_library_mobile_user';
const SERVER_URL_KEY = 'semester_library_server_url';

export interface StudentUser {
  studentId: string;
  name: string;
  role: string;
  isAdmin?: boolean;
  avatarUrl?: string;
  department?: string;
  semester?: string;
}

interface AuthContextType {
  user: StudentUser | null;
  token: string | null;
  serverUrl: string;
  isLoading: boolean;
  login: (studentId: string, password: string, customUrl?: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  updateServerUrl: (url: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<StudentUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState<string>(getAutoDetectedServerUrl());
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Initialize auth state on app load without blocking first render
  useEffect(() => {
    let isMounted = true;

    async function initializeAuth() {
      try {
        // 1. Load custom server URL if configured
        const savedUrl = await SecureStore.getItemAsync(SERVER_URL_KEY);
        const activeUrl = savedUrl || getAutoDetectedServerUrl();
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
            if (cachedUser) setUser(cachedUser);
            // CRITICAL: Unblock UI render immediately with cached credentials (0ms delay)
            setIsLoading(false);
          }

          // 3. Verify token against /api/me in the background
          void (async () => {
            try {
              const res = await fetch(`${activeUrl}/api/me`, {
                headers: {
                  Authorization: `Bearer ${storedToken}`,
                  Accept: 'application/json',
                },
              });

              if (res.status === 200) {
                const freshUser: StudentUser = await res.json();
                if (isMounted) {
                  setUser(freshUser);
                }
                await SecureStore.setItemAsync(USER_KEY, JSON.stringify(freshUser));
                // Pre-warm realtime connection in background
                void initChatRealtime(freshUser.studentId);
              } else if (res.status === 401) {
                // Token invalid or revoked
                await SecureStore.deleteItemAsync(TOKEN_KEY);
                await SecureStore.deleteItemAsync(USER_KEY);
                if (isMounted) {
                  setToken(null);
                  setUser(null);
                  router.replace('/login');
                }
              }
            } catch {
              // Network error: maintain cached session
              if (cachedUser) {
                void initChatRealtime(cachedUser.studentId);
              }
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

  const login = async (studentId: string, password: string, customUrl?: string) => {
    const targetUrl = customUrl ? customUrl.trim() : serverUrl;
    try {
      const res = await fetch(`${targetUrl}/api/mobile/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          studentId: studentId.trim(),
          password,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.status === 200 && data.token) {
        await SecureStore.setItemAsync(TOKEN_KEY, data.token);
        if (data.user) {
          await SecureStore.setItemAsync(USER_KEY, JSON.stringify(data.user));
        }
        if (customUrl && customUrl !== serverUrl) {
          await updateServerUrl(customUrl);
        }
        setToken(data.token);
        setUser(data.user);

        // Pre-warm realtime in background right after login
        if (data.user?.studentId) {
          void initChatRealtime(data.user.studentId);
        }

        router.replace('/(tabs)');
        return { success: true };
      } else {
        return {
          success: false,
          error: data.message || `Login failed (HTTP ${res.status})`,
        };
      }
    } catch (err: any) {
      return {
        success: false,
        error: `Could not connect to ${targetUrl}. Ensure your phone is on the same Wi-Fi.`,
      };
    }
  };

  const logout = async () => {
    try {
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
      await disconnectChatRealtime();
      await clearChatDb();
      await clearAppQueryCache();
    } catch (e) {
      console.warn('Logout error:', e);
    } finally {
      setToken(null);
      setUser(null);
      router.replace('/login');
    }
  };

  const updateServerUrl = async (newUrl: string) => {
    const sanitized = newUrl.trim().replace(/\/+$/, '');
    await SecureStore.setItemAsync(SERVER_URL_KEY, sanitized);
    setServerUrl(sanitized);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        serverUrl,
        isLoading,
        login,
        logout,
        updateServerUrl,
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
