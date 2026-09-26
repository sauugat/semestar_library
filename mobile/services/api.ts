import * as SecureStore from 'expo-secure-store';
import { router } from 'expo-router';

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

export async function getBaseUrl(): Promise<string> {
  try {
    const saved = await SecureStore.getItemAsync(SERVER_URL_STORAGE_KEY);
    return saved ? saved.trim().replace(/\/+$/, '') : DEFAULT_SERVER_URL;
  } catch {
    return DEFAULT_SERVER_URL;
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

  const headers = new Headers(options.headers || {});

  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  if (options.body && typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers,
    });
  } catch (netErr: any) {
    throw new ApiError(
      `Cannot connect to server at ${baseUrl}. Ensure your phone and computer are on the same Wi-Fi.`,
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
    const res = await apiFetch(endpoint, {
      ...options,
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
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
