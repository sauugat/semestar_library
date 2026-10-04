import * as SecureStore from 'expo-secure-store';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import { invalidateChatSession } from './chat-session';

export const DEFAULT_SERVER_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  (Constants.expoConfig?.extra as any)?.apiUrl ||
  'https://semestar-library.vercel.app';
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
  if (!__DEV__) {
    try {
      await SecureStore.deleteItemAsync(SERVER_URL_STORAGE_KEY).catch(() => {});
    } catch {}

    if (process.env.EXPO_PUBLIC_API_URL && process.env.EXPO_PUBLIC_API_URL.trim()) {
      return process.env.EXPO_PUBLIC_API_URL.trim().replace(/\/+$/, '');
    }

    const extraUrl = (Constants.expoConfig?.extra as any)?.apiUrl;
    if (extraUrl && typeof extraUrl === 'string' && extraUrl.trim()) {
      return extraUrl.trim().replace(/\/+$/, '');
    }

    return DEFAULT_SERVER_URL;
  }

  // Development builds: allow developer override from SecureStore
  try {
    const saved = await SecureStore.getItemAsync(SERVER_URL_STORAGE_KEY);
    if (saved && saved.trim()) {
      return saved.trim().replace(/\/+$/, '');
    }
  } catch {}

  if (process.env.EXPO_PUBLIC_API_URL && process.env.EXPO_PUBLIC_API_URL.trim()) {
    return process.env.EXPO_PUBLIC_API_URL.trim().replace(/\/+$/, '');
  }

  const extraUrl = (Constants.expoConfig?.extra as any)?.apiUrl;
  if (extraUrl && typeof extraUrl === 'string' && extraUrl.trim()) {
    return extraUrl.trim().replace(/\/+$/, '');
  }

  return DEFAULT_SERVER_URL;
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
  const baseUrl = await getBaseUrl();
  const token = await getAuthToken();

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
      console.log(`[CLIENT API] ${options.method || 'GET'} ${endpoint} -> ${response.status} (${duration}ms)`);
    }
  } catch (netErr: any) {
    const duration = Date.now() - startTime;
    if (__DEV__) {
      console.log(`[CLIENT API FAILED] ${options.method || 'GET'} ${endpoint} (${duration}ms):`, netErr?.message);
    }
    if (netErr instanceof ApiError) throw netErr;
    const msg = netErr?.message || 'Network request failed';
    const errorText = __DEV__
      ? `${msg} (Cannot connect to server at ${baseUrl}. Ensure your phone and computer are on the same Wi-Fi.)`
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
