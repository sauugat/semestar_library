import React, { createContext, useContext, useState, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';
import { router } from 'expo-router';

export const DEFAULT_SERVER_URL = 'http://192.168.1.65:3000';
const TOKEN_KEY = 'semester_library_mobile_token';
const SERVER_URL_KEY = 'semester_library_server_url';

export interface StudentUser {
  studentId: string;
  name: string;
  role: string;
  isAdmin?: boolean;
  avatarUrl?: string;
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
  const [serverUrl, setServerUrl] = useState<string>(DEFAULT_SERVER_URL);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Initialize auth state on app load
  useEffect(() => {
    let isMounted = true;

    async function initializeAuth() {
      try {
        // 1. Load custom server URL if previously configured
        const savedUrl = await SecureStore.getItemAsync(SERVER_URL_KEY);
        const activeUrl = savedUrl || DEFAULT_SERVER_URL;
        if (isMounted) setServerUrl(activeUrl);

        // 2. Load stored token
        const storedToken = await SecureStore.getItemAsync(TOKEN_KEY);
        if (storedToken) {
          // Verify token against /api/me
          try {
            const res = await fetch(`${activeUrl}/api/me`, {
              headers: {
                'Authorization': `Bearer ${storedToken}`,
                'Accept': 'application/json',
              },
            });

            if (res.status === 200) {
              const userData: StudentUser = await res.json();
              if (isMounted) {
                setToken(storedToken);
                setUser(userData);
              }
            } else {
              // Token invalid or expired
              await SecureStore.deleteItemAsync(TOKEN_KEY);
            }
          } catch (netErr) {
            // In case device is temporarily offline, keep token session
            if (isMounted) setToken(storedToken);
          }
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
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          studentId: studentId.trim(),
          password,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.status === 200 && data.token) {
        await SecureStore.setItemAsync(TOKEN_KEY, data.token);
        if (customUrl && customUrl !== serverUrl) {
          await updateServerUrl(customUrl);
        }
        setToken(data.token);
        setUser(data.user);
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
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
          },
        }).catch(() => {});
      }
      await SecureStore.deleteItemAsync(TOKEN_KEY);
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
