import type { AdminSettings, Post } from './domain';

declare global {
  interface Window {
    __GMS_CONFIG__?: { apiUrl?: string };
  }
}

export const apiUrl = window.__GMS_CONFIG__?.apiUrl || import.meta.env.VITE_API_URL || 'http://localhost:4000';

async function parseData<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Request failed. Please try again.');
  return body.data;
}

export async function getPosts(): Promise<Post[]> {
  return parseData<Post[]>(await fetch(`${apiUrl}/api/posts`));
}

export async function getPost(slug: string): Promise<Post> {
  return parseData<Post>(await fetch(`${apiUrl}/api/posts/${slug}`));
}

export async function subscribe(email: string) {
  return parseData<{ email: string }>(
    await fetch(`${apiUrl}/api/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }),
  );
}

export type BookProduct = {
  title: string;
  author: string;
  amountCents: number;
  currency: string;
};

export async function getBook(): Promise<BookProduct> {
  return parseData<BookProduct>(await fetch(`${apiUrl}/api/book`));
}

export async function createBookCheckout() {
  return parseData<{ checkoutUrl: string }>(await fetch(`${apiUrl}/api/book/checkout`, { method: 'POST' }));
}

export async function getBookOrderStatus(sessionId: string) {
  return parseData<{ status: 'pending' | 'paid'; downloadUrl?: string }>(
    await fetch(`${apiUrl}/api/book/status?session_id=${encodeURIComponent(sessionId)}`),
  );
}

export function absoluteApiUrl(relativeUrl: string) {
  return new URL(relativeUrl, `${apiUrl}/`).href;
}

export async function request<T>(path: string, options: RequestInit = {}, token?: string, csrfToken?: string): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (csrfToken) headers.set('x-csrf-token', csrfToken);
  return parseData<T>(
    await fetch(`${apiUrl}${path}`, {
      ...options,
      headers,
      credentials: 'include',
    }),
  );
}

export type { AdminSettings, Post };
