// src/lib/api.ts
export async function api<T>(
  path: string,
  opts: { method?: string; body?: any; token?: string; form?: boolean } = {}
): Promise<T | string> {
  const { method = 'GET', body, token, form } = opts;
  const headers: Record<string, string> = {};

  if (!form) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}${path}`, {
    method,
    headers,
    body: form ? body : body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });

  if (!res.ok) {
    const txt = await res.text();
    return txt || `HTTP ${res.status}`;
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}
