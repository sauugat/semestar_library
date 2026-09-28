import * as SecureStore from 'expo-secure-store';
import { router } from 'expo-router';
import Constants from 'expo-constants';

export const DEFAULT_SERVER_URL = 'http://192.168.1.65:3000';
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
    const hostUri = Constants.expoConfig?.hostUri || (Constants as any).manifest2?.extra?.expoGo?.debuggerHost;
    if (hostUri) {
      const host = hostUri.split(':')[0];
      if (host) {
        return `http://${host}:3000`;
      }
    }
  } catch {}
  return DEFAULT_SERVER_URL;
}

export async function getBaseUrl(): Promise<string> {
  try {
    const saved = await SecureStore.getItemAsync(SERVER_URL_STORAGE_KEY);
    return saved ? saved.trim().replace(/\/+$/, '') : getAutoDetectedServerUrl();
  } catch {
    return getAutoDetectedServerUrl();
  }
}

export async function getAuthToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export async function clearAuthToken(): Promise<void> {
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
    // React Native's fetch will automatically generate multipart/form-data with the correct boundary.
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
    response = await fetch(url, {
      ...options,
      headers,
    });
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
    throw new ApiError(
      `${msg} (Cannot connect to server at ${baseUrl}. Ensure your phone and computer are on the same Wi-Fi.)`,
      0
    );
  }

  // Handle 401 Unauthorized (expired token or invalid session)
  if (response.status === 401) {
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
