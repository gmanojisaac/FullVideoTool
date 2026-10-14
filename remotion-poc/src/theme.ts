export interface Rect { x: number; y: number; width: number; height: number }
export interface Tile { number: number; text: string; audio: string; image: string; seconds: number; /** Auto-detected artwork inside the tile PNG (tile pixels), with the PNG size. */ art: Rect; tileWidth: number; tileHeight: number;
  /** Character emotion loop, already cropped to the card (same first frame as the still). `placeholder` marks a synthetic drift. */
  loop?: { src: string; frames: number; placeholder: boolean };
  /** Narration loudness per video frame, 0–1, for the voice-reactive wave. */
  levels?: number[] }
export interface Cell { x: number; y: number; width: number; height: number }
export interface LessonData { title: string; format?: 'mobile' | 'desktop'; /** Card size in pixels, shared by the still and the loop clips. */ card?: { width: number; height: number }; grid: string; gridWidth: number; gridHeight: number; cells: Cell[]; tiles: Tile[] }

export const fps = 30;
export const width = 1920, height = 1080;
export const introFrames = 90, outroFrames = 96, leadFrames = 24, pullFrames = 36, gridHoldFrames = 12, tailFrames = pullFrames + gridHoldFrames;
export const colors = { bg: '#060913', ink: '#f4f6fb', dim: 'rgba(244,246,251,.34)', accent: '#7aa2ff', accent2: '#c78bff', warm: '#ffc98a', glass: 'rgba(255,255,255,.07)', glassLine: 'rgba(255,255,255,.14)' };
export const font = '"Segoe UI Variable Display","Segoe UI",system-ui,sans-serif';

export const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const smootherstep = (t: number) => { const x = clamp(t); return x * x * x * (x * (x * 6 - 15) + 10); };
export const tileFrames = (t: Tile) => leadFrames + Math.ceil(t.seconds * fps) + tailFrames;
export const totalFrames = (d: LessonData) => introFrames + d.tiles.reduce((n, t) => n + tileFrames(t), 0) + outroFrames;

const stop = new Set('first second third last next finally nobody needs whatever whenever anything nothing something everything almost already instead about after again against along also among around because been before being between both cannot could does doing down during each either else even ever every from further have having here himself into itself just least less made make many might more most much must never nobody only other over same should since some such than that their them then there these they this those through under until upon very were what when where which while whom whose will with within without would your'.split(' '));
/** Word timing: weight each word by its letters, plus a pause after punctuation, spread over the narration. */
export function wordTimings(text: string, seconds: number) {
  const words = text.split(/\s+/).filter(Boolean), weights = words.map(w => Math.max(2, w.replace(/[^A-Za-z0-9']/g, '').length) + (/[.!?]$/.test(w) ? 5 : /[,;:]$/.test(w) ? 2.5 : 0));
  const total = weights.reduce((a, b) => a + b, 0); let acc = 0;
  return words.map((word, i) => { const start = acc / total * seconds; acc += weights[i]; return { word, start, end: acc / total * seconds }; });
}
/** Up to three long, non-stop words in order of appearance. */
export function keyPhrases(text: string, count = 3) {
  // Without a part-of-speech tagger, drop adverbs, "-thing"/"-body" pronouns and verb forms, which make poor labels.
  const weak = /(ly|thing|body|ing|ed)$/i, seen = new Set<string>();
  const candidates = text.split(/\s+/).map(w => w.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '')).filter(w => w.length >= 4 && !stop.has(w.toLowerCase()) && !weak.test(w) && !seen.has(w.toLowerCase()) && seen.add(w.toLowerCase()));
  const picked = [...candidates].sort((a, b) => b.length - a.length).slice(0, count);
  return candidates.filter(c => picked.includes(c)).map(c => c[0].toUpperCase() + c.slice(1).toLowerCase());
}
