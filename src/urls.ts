/** API and media stay on the viewer's computer when the editor is hosted. */
export const apiBaseUrl = (import.meta.env?.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

export function apiUrl(url: string): string;
export function apiUrl(url: string | undefined): string | undefined;
export function apiUrl(url: string | undefined) {
  return url?.startsWith('/api/') ? apiBaseUrl + url : url;
}
