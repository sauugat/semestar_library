import * as SecureStore from 'expo-secure-store';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import { invalidateChatSession } from './chat-session';

export const PRODUCTION_SERVER_URL = 'https://semestar-library.vercel.app';
export const DEFAULT_SERVER_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  (Constants.expoConfig?.extra as any)?.apiUrl ||
  PRODUCTION_SERVER_URL;
export const TOKEN_STORAGE_KEY = 'semester_library_mobile_token';
export const SERVER_URL_STORAGE_KEY = 'semester_library_server_url';

export class ApiError extends Error {
  status: number;
  data: any;

  constructor(message: string, status: number, data?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

export function isLocalAddress(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url.trim());
    const hostname = parsed.hostname.toLowerCase();
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.endsWith('.local') ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
    );
  } catch {
    return false;
  }
}

/**
 * Validates whether a target backend URL belongs to an approved/trusted origin.
 * Rules:
 * - Production builds (!__DEV__): strictly requires HTTPS and must be either the production
 *   domain or an approved vercel.app deployment origin. Insecure HTTP is forbidden.
 * - Development builds (__DEV__): allows local development LAN/loopback HTTP addresses,
 *   as well as approved remote HTTPS deployment origins (Vercel staging/preview/production).
 */
export function isTrustedServerUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  const clean = url.trim();
  try {
    const parsed = new URL(clean);
    const protocol = parsed.protocol.toLowerCase();
    const hostname = parsed.hostname.toLowerCase();

    if (!__DEV__) {
      if (protocol !== 'https:') return false;
      return (
        hostname === 'semestar-library.vercel.app' ||
        hostname.endsWith('.vercel.app')
      );
    }

    // In development mode:
    if (protocol === 'http:') {
      return isLocalAddress(clean);
    }

    if (protocol === 'https:') {
      return (
        hostname === 'semestar-library.vercel.app' ||
        hostname.endsWith('.vercel.app') ||
        Boolean(
          process.env.EXPO_PUBLIC_API_URL &&
          new URL(process.env.EXPO_PUBLIC_API_URL).hostname.toLowerCase() === hostname
        )
      );
    }

    return false;
  } catch {
    return false;
  }
}

export function getAutoDetectedServerUrl(): string {
  try {
    if (__DEV__) {
      const hostUri = Constants.expoConfig?.hostUri || (Constants as any).manifest2?.extra?.expoGo?.debuggerHost;
      if (hostUri) {
        const host = hostUri.split(':')[0];
        if (host && host !== 'localhost' && host !== '127.0.0.1') {
          return `http://${host}:3000`;
        }
      }
    }
  } catch {}
  return DEFAULT_SERVER_URL;
}

export async function getBaseUrl(): Promise<string> {
  // In production builds (!__DEV__), NEVER allow custom/arbitrary server URL overrides.
  // Purge any stored key and lock strictly to trusted production configuration.
  // Ensure development URL overrides cannot accidentally redirect production builds to a local HTTP address.
  if (!__DEV__) {
    try {
      await SecureStore.deleteItemAsync(SERVER_URL_STORAGE_KEY).catch(() => {});
    } catch {}

    const envUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
    if (envUrl && isTrustedServerUrl(envUrl)) {
      return envUrl.replace(/\/+$/, '');
    }

    const extraUrl = (Constants.expoConfig?.extra as any)?.apiUrl;
    if (extraUrl && typeof extraUrl === 'string' && extraUrl.trim() && isTrustedServerUrl(extraUrl)) {
      return extraUrl.trim().replace(/\/+$/, '');
    }

    return PRODUCTION_SERVER_URL;
  }

  // Development builds (__DEV__):
  // 1. Allow developer override from SecureStore if it is a valid and trusted origin
  try {
    const saved = await SecureStore.getItemAsync(SERVER_URL_STORAGE_KEY);
    if (saved && saved.trim()) {
      const cleanSaved = saved.trim().replace(/\/+$/, '');
      if (isTrustedServerUrl(cleanSaved)) {
        return cleanSaved;
      }
      // If stored key is untrusted or invalid, purge it safely
      await SecureStore.deleteItemAsync(SERVER_URL_STORAGE_KEY).catch(() => {});
    }
  } catch {}

  // 2. Explicit environment variable EXPO_PUBLIC_API_URL (e.g. from mobile/.env or EAS build env)
  if (process.env.EXPO_PUBLIC_API_URL && process.env.EXPO_PUBLIC_API_URL.trim()) {
    const envUrl = process.env.EXPO_PUBLIC_API_URL.trim().replace(/\/+$/, '');
    if (isTrustedServerUrl(envUrl)) {
      return envUrl;
    }
  }

  // 3. Auto-detected LAN server from Expo development bundler host (Expo Go on Wi-Fi)
  const autoUrl = getAutoDetectedServerUrl();
  if (autoUrl && isTrustedServerUrl(autoUrl)) {
    return autoUrl;
  }

  // 4. Fallback to extra.apiUrl from app.json
  const extraUrl = (Constants.expoConfig?.extra as any)?.apiUrl;
  if (extraUrl && typeof extraUrl === 'string' && extraUrl.trim() && isTrustedServerUrl(extraUrl)) {
    return extraUrl.trim().replace(/\/+$/, '');
  }

  return PRODUCTION_SERVER_URL;
}

export async function getAuthToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export async function clearAuthToken(): Promise<void> {
  invalidateChatSession();
  try {
    await SecureStore.deleteItemAsync(TOKEN_STORAGE_KEY);
  } catch {}
}

export async function apiFetch(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const preparationStart = Date.now();
  const [baseUrl, token] = await Promise.all([getBaseUrl(), getAuthToken()]);
  const preparationMs = Date.now() - preparationStart;

  const url = endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

  // Prepare headers as a plain dictionary for React Native fetch / Hermes compatibility
  const headers: Record<string, string> = {};

  if (options.headers) {
    if (typeof (options.headers as any).forEach === 'function') {
      (options.headers as any).forEach((value: string, key: string) => {
        headers[key] = value;
      });
    } else if (Array.isArray(options.headers)) {
      options.headers.forEach(([key, value]) => {
        headers[key] = value;
      });
    } else {
      Object.assign(headers, options.headers);
    }
  }

  // Set default Accept header if not explicitly provided
  const hasAccept = Object.keys(headers).some((k) => k.toLowerCase() === 'accept');
  if (!hasAccept) {
    headers['Accept'] = 'application/json';
  }

  // Set Authorization header if token exists and not already provided
  const hasAuth = Object.keys(headers).some((k) => k.toLowerCase() === 'authorization');
  if (token && !hasAuth) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Check if body is FormData
  const isFormData =
    (typeof FormData !== 'undefined' && options.body instanceof FormData) ||
    Boolean((options.body as any)?._parts);

  if (isFormData) {
    // CRITICAL: Do NOT set Content-Type header on FormData.
    // React Native's native XHR will automatically generate multipart/form-data with the correct boundary.
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'content-type') {
        delete headers[key];
      }
    }
  } else if (options.body && typeof options.body === 'string') {
    const hasContentType = Object.keys(headers).some((k) => k.toLowerCase() === 'content-type');
    if (!hasContentType) {
      headers['Content-Type'] = 'application/json';
    }
  }

  const startTime = Date.now();
  let response: Response;
  try {
    if (isFormData) {
      // In React Native / Expo SDK 57, global fetch uses Expo Winter runtime which does not support
      // the React Native { uri, name, type } FormData part object ("Unsupported FormDataPart implementation").
      // XMLHttpRequest utilizes the native platform networking bridge to stream local file URIs safely.
      response = await new Promise<Response>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(options.method || 'POST', url);

        for (const [key, value] of Object.entries(headers)) {
          if (key.toLowerCase() !== 'content-type') {
            xhr.setRequestHeader(key, value);
          }
        }

        xhr.onload = () => {
          const responseHeaders = new Headers();
          try {
            const allHeaders = xhr.getAllResponseHeaders();
            if (allHeaders) {
              allHeaders
                .trim()
                .split(/[\r\n]+/)
                .forEach((line) => {
                  const parts = line.split(': ');
                  const header = parts.shift();
                  const value = parts.join(': ');
                  if (header) responseHeaders.set(header, value);
                });
            }
          } catch {}

          if (xhr.status === 0) {
            reject(new ApiError(`Upload request failed to ${url} (network connection lost)`, 0));
            return;
          }

          let resObj: Response;
          try {
            resObj = new Response(xhr.responseText, {
              status: xhr.status,
              statusText: xhr.statusText || (xhr.status >= 200 && xhr.status < 300 ? 'OK' : ''),
              headers: responseHeaders,
            });
          } catch {
            resObj = {
              status: xhr.status,
              statusText: xhr.statusText || '',
              ok: xhr.status >= 200 && xhr.status < 300,
              headers: responseHeaders,
              text: async () => xhr.responseText,
              json: async () => JSON.parse(xhr.responseText || '{}'),
            } as any;
          }
          resolve(resObj);
        };

        xhr.onerror = (e) => {
          if (__DEV__) {
            console.warn(`[apiFetch] Upload network/file error to ${url}:`, e);
          }
          reject(new ApiError(`Upload request failed to ${url}`, 0));
        };

        xhr.ontimeout = () => {
          reject(new ApiError(`Upload request timed out to ${url}`, 0));
        };

        xhr.send(options.body);
      });
    } else {
      response = await fetch(url, {
        ...options,
        headers,
      });
    }

    const duration = Date.now() - startTime;
    if (__DEV__) {
      console.log(`[CLIENT API] ${options.method || 'GET'} ${endpoint} -> ${response.status} (${duration}ms; prepare=${preparationMs}ms; request=${response.headers.get('X-Request-ID') || 'n/a'}; server=${response.headers.get('Server-Timing') || 'n/a'})`);
    }
  } catch (netErr: any) {
    const duration = Date.now() - startTime;
    if (__DEV__) {
      console.log(`[CLIENT API FAILED] ${options.method || 'GET'} ${endpoint} (${duration}ms):`, netErr?.message);
    }
    if (netErr instanceof ApiError) throw netErr;
    const msg = netErr?.message || 'Network request failed';
    const errorText = __DEV__
      ? isLocalAddress(baseUrl)
        ? `${msg} (Cannot connect to local server at ${baseUrl}. Ensure your phone and computer are on the same Wi-Fi and the Express server is running.)`
        : `${msg} (Cannot connect to remote server at ${baseUrl}. Verify the deployment URL is active, reachable, and has no CORS/network issues.)`
      : 'Unable to connect to Semester Library. Check your internet connection and try again.';
    throw new ApiError(errorText, 0);
  }

  // Handle 401 Unauthorized (expired token or invalid session)
  if (response.status === 401) {
    const sentToken = (Object.entries(headers).find(([key])=>key.toLowerCase()==='authorization')?.[1] || '').replace(/^Bearer /,'');
    if (sentToken !== await getAuthToken()) throw new ApiError('Expired request session.',401);
    await clearAuthToken();
    try {
      router.replace('/login');
    } catch {}
    throw new ApiError('Authentication required or session expired. Please sign in.', 401);
  }

  return response;
}

export const api = {
  get: async <T = any>(endpoint: string, options: RequestInit = {}): Promise<T> => {
    const res = await apiFetch(endpoint, { ...options, method: 'GET' });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new ApiError(errBody.message || `Request failed with status ${res.status}`, res.status, errBody);
    }
    return res.json();
  },

  post: async <T = any>(endpoint: string, body?: any, options: RequestInit = {}): Promise<T> => {
    const isFormData =
      (typeof FormData !== 'undefined' && body instanceof FormData) ||
      Boolean((body as any)?._parts);
    const reqBody = isFormData ? body : body !== undefined ? JSON.stringify(body) : undefined;

    const res = await apiFetch(endpoint, {
      ...options,
      method: 'POST',
      body: reqBody,
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new ApiError(errBody.message || `Request failed with status ${res.status}`, res.status, errBody);
    }
    return res.json();
  },

  put: async <T = any>(endpoint: string, body?: any, options: RequestInit = {}): Promise<T> => {
    const isFormData =
      (typeof FormData !== 'undefined' && body instanceof FormData) ||
      Boolean((body as any)?._parts);
    const reqBody = isFormData ? body : body !== undefined ? JSON.stringify(body) : undefined;

    const res = await apiFetch(endpoint, {
      ...options,
      method: 'PUT',
      body: reqBody,
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new ApiError(errBody.message || `Request failed with status ${res.status}`, res.status, errBody);
    }
    return res.json();
  },

  patch: async <T = any>(endpoint: string, body?: any, options: RequestInit = {}): Promise<T> => {
    const isFormData =
      (typeof FormData !== 'undefined' && body instanceof FormData) ||
      Boolean((body as any)?._parts);
    const reqBody = isFormData ? body : body !== undefined ? JSON.stringify(body) : undefined;

    const res = await apiFetch(endpoint, {
      ...options,
      method: 'PATCH',
      body: reqBody,
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new ApiError(errBody.message || `Request failed with status ${res.status}`, res.status, errBody);
    }
    return res.json();
  },

  delete: async <T = any>(endpoint: string, options: RequestInit = {}): Promise<T> => {
    const res = await apiFetch(endpoint, { ...options, method: 'DELETE' });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new ApiError(errBody.message || `Request failed with status ${res.status}`, res.status, errBody);
    }
    return res.json();
  },

  getBaseUrl,
  getAuthToken,
};
