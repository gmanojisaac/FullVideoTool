export const narrationVoices = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'] as const;
export const narrationModels = ['gpt-4o-mini-tts', 'tts-1-hd', 'tts-1'] as const;
export type NarrationVoice = typeof narrationVoices[number];
export type NarrationModel = typeof narrationModels[number];
export const maxNarrationText = 1500;
export const maxNarrationInstructions = 500;
export interface TileNarration { tileNumber: number; text: string }
export interface NarrationScript { version: 1; module: 'narration'; projectId: string; updatedAt: string | null; voice: NarrationVoice; model: NarrationModel; instructions: string; tiles: TileNarration[] }
export interface NarrationState { script: NarrationScript; saved: boolean; keyConfigured: boolean }
export interface GeneratedNarration { tileNumber: number; mediaId: string; filename: string; duration: number }

export const defaultNarrationLines = [
  'After a long day, he finally sits down. The house is quiet, and for the first time in hours, nobody needs anything from him.',
  'He walks to the window and lets his shoulders drop. The light outside is soft, and the tension he has carried all day begins to ease.',
  'At his desk, he pours a cup of tea and opens his notebook. Writing things down makes them feel a little lighter.',
  'His phone buzzes, and he almost reaches for it. Instead, he puts it down. Whatever it is can wait until tomorrow.',
  'In the kitchen, he fills a glass of water slowly. A small, kind thing to do for himself, and it feels like enough.',
  'On the balcony, the evening settles over the city. He takes one long breath, and lets the day go.',
];
export function defaultNarrationScript(projectId: string): NarrationScript {
  return { version: 1, module: 'narration', projectId, updatedAt: null, voice: 'ash', model: 'gpt-4o-mini-tts', instructions: 'Speak slowly, warmly and calmly, like a quiet reflective voice-over. Leave natural pauses between sentences.', tiles: defaultNarrationLines.map((text, i) => ({ tileNumber: i + 1, text })) };
}
export function validateNarrationScript(s: NarrationScript): string[] {
  if (!s || s.version !== 1 || s.module !== 'narration' || !Array.isArray(s.tiles) || s.tiles.length !== 6) return ['Provide six narration lines.'];
  if (!(narrationVoices as readonly string[]).includes(s.voice) || !(narrationModels as readonly string[]).includes(s.model)) return ['Choose a supported voice and model.'];
  if (typeof s.instructions !== 'string' || s.instructions.length > maxNarrationInstructions) return [`Voice instructions must be at most ${maxNarrationInstructions} characters.`];
  if (new Set(s.tiles.map(t => t.tileNumber)).size !== 6 || s.tiles.some(t => !Number.isInteger(t.tileNumber) || t.tileNumber < 1 || t.tileNumber > 6)) return ['Tile numbers must be the unique values 1 to 6.'];
  if (s.tiles.some(t => typeof t.text !== 'string' || !t.text.trim() || t.text.length > maxNarrationText)) return [`Each tile needs narration text of 1–${maxNarrationText} characters.`];
  return [];
}
