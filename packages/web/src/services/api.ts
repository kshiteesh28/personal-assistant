const AUTH_KEY = 'secretary_auth_token';

export function getAuthToken(): string | null {
  return localStorage.getItem(AUTH_KEY);
}

export function setAuthToken(token: string) {
  localStorage.setItem(AUTH_KEY, token);
}

export function authHeaders(): HeadersInit {
  return {
    'Authorization': `Bearer ${getAuthToken()}`,
    'Content-Type': 'application/json'
  };
}

export async function bootstrap() {
  const res = await fetch('/api/bootstrap');
  if (!res.ok) throw new Error('Bootstrap failed');
  const data = await res.json();
  if (data.authToken) {
    setAuthToken(data.authToken);
  }
}

export async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: { ...authHeaders(), ...options?.headers }
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'API Error');
  }
  return res.status === 204 ? null as unknown as T : res.json();
}

export const api = {
  get: <T>(path: string) => fetchApi<T>(path),
  post: <T>(path: string, body: any) => fetchApi<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body: any) => fetchApi<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: any) => fetchApi<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (path: string) => fetchApi<null>(path, { method: 'DELETE' }),
  postBlob: async <T>(path: string, blob: Blob, contentType?: string): Promise<T> => {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${getAuthToken()}`, ...(contentType ? { 'Content-Type': contentType } : {}) },
      body: blob,
    });
    if (!res.ok) throw new Error('API Error');
    return res.status === 204 ? null as unknown as T : res.json();
  },
};
