import type { Project, Layout, CheckResult } from '../shared/project';

export async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status}).`);
  return body as T;
}
export const jsonOptions = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export async function uploadImage(file: File) {
  const allowed = /\.(png|jpe?g|webp)$/i;
  if (!allowed.test(file.name)) throw new Error('Unsupported image. Use PNG, JPG, or WEBP.');
  if (file.size > 20 * 1024 * 1024) throw new Error('Image exceeds the 20 MB upload limit.');
  const data = new FormData(); data.append('image', file);
  return request<Project>('/api/upload', { method: 'POST', body: data });
}
export interface SavedProject { id: string; title: string; updatedAt: string; layout: Layout }
export interface CheckReport { results: CheckResult[]; passed: number; total: number; completedAt: string }
