import type { CSSProperties } from 'react';

const paths = {
  upload: <><path d="M12 16V4m-4 4 4-4 4 4"/><path d="M4 15v5h16v-5"/></>,
  folder: <path d="M3 7h7l2 2h9v11H3V7Zm0 0V4h7l2 3"/>,
  save: <><path d="M4 3h13l4 4v14H3V3Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5 8a8 8 0 0 1 13-3l2 3M4 16l2 3a8 8 0 0 0 13-3"/></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/></>,
  arrow: <path d="M5 12h14m-5-5 5 5-5 5"/>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  download: <><path d="M12 3v13m-4-4 4 4 4-4"/><path d="M4 16v5h16v-5"/></>,
  close: <path d="m6 6 12 12M6 18 18 6"/>,
  grid: <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18M3 9h18M3 15h18"/></>,
  flask: <><path d="M9 3h6m-5 0v6l-6 10a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2L14 9V3M7 15h10"/></>,
} as const;

export default function Icon({ name, size = 18, style }: { name: keyof typeof paths; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>{paths[name]}</svg>;
}
