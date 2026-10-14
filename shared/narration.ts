export const narrationVoices = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'] as const;
export const narrationModels = ['gpt-4o-mini-tts', 'tts-1-hd', 'tts-1'] as const;
export type NarrationVoice = typeof narrationVoices[number];
export type NarrationModel = typeof narrationModels[number];
/** `auto` rotates through the four-voice pool, one voice per video, round-robin. */
export type NarrationVoiceChoice = NarrationVoice | 'auto';
export const maxNarrationText = 1500;
export const maxNarrationInstructions = 500;
export interface TileNarration { tileNumber: number; text: string }
export interface NarrationScript {
  version: 1; module: 'narration'; projectId: string; updatedAt: string | null; voice: NarrationVoiceChoice; model: NarrationModel; instructions: string; tiles: TileNarration[];
  /** The pool voice chosen for this project's latest full generation; single-tile re-takes reuse it so the video keeps one voice. */
  assignedVoice?: NarrationVoice;
}
export interface NarrationState { script: NarrationScript; saved: boolean; keyConfigured: boolean; nextVoice: NarrationVoice }
export interface GeneratedNarration { tileNumber: number; mediaId: string; filename: string; duration: number; voice?: NarrationVoice }

/** The four voices that take turns, one per video created. */
export const voiceRotation = ['coral', 'nova', 'shimmer', 'sage'] as const satisfies readonly NarrationVoice[];
export type RotationVoice = typeof voiceRotation[number];
/** What makes each pool voice sound different; added to the speaking instructions so the four do not blur together. */
export const voiceProfiles: Record<RotationVoice, string> = {
  coral: 'Bright and friendly, with a gentle smile in the voice; a medium, easy pace.',
  nova: 'Clear, caring and steady; calm confidence, slightly lower pitch, unhurried.',
  shimmer: 'Soft, airy and soothing; light touch, slow and spacious phrasing.',
  sage: 'Grounded, thoughtful and reassuring; measured pace and a settled tone.',
};
export const naturalProsody = 'Natural conversational delivery, never monotone: vary pitch and pace from sentence to sentence, lift slightly on the key emotional word, pause briefly at commas and longer at full stops, breathe naturally, no exaggerated acting.';
/** Position-aware hints so six clips played back to back have an arc rather than six identical reads. */
export function positionHint(index: number, total: number): string {
  if (index === 0) return 'Open gently and unhurried, as if settling someone in.';
  if (index === total - 1) return 'Slow a little on the final sentence and let the last words resolve softly with a gentle downward intonation.';
  return 'Keep the same warm voice; let the energy move a little with the meaning, then settle.';
}
/** Full speaking instructions for one tile: pool-voice character + the author's style + natural prosody + position in the lesson. */
export function deliveryInstructions(voice: NarrationVoice, base: string, index: number, total = 6): string {
  const profile = (voiceProfiles as Record<string, string>)[voice];
  return [base.trim(), profile, naturalProsody, positionHint(index, total)].filter(Boolean).join(' ');
}

export const defaultNarrationLines = [
  'After a long day, he finally sits down. The house is quiet, and for the first time in hours, nobody needs anything from him.',
  'He walks to the window and lets his shoulders drop. The light outside is soft, and the tension he has carried all day begins to ease.',
  'At his desk, he pours a cup of tea and opens his notebook. Writing things down makes them feel a little lighter.',
  'His phone buzzes, and he almost reaches for it. Instead, he puts it down. Whatever it is can wait until tomorrow.',
  'In the kitchen, he fills a glass of water slowly. A small, kind thing to do for himself, and it feels like enough.',
  'On the balcony, the evening settles over the city. He takes one long breath, and lets the day go.',
];
export function defaultNarrationScript(projectId: string): NarrationScript {
  return { version: 1, module: 'narration', projectId, updatedAt: null, voice: 'auto', model: 'gpt-4o-mini-tts', instructions: 'Warm, empathetic Indian English female narrator.', tiles: defaultNarrationLines.map((text, i) => ({ tileNumber: i + 1, text })) };
}
export function validateNarrationScript(s: NarrationScript): string[] {
  if (!s || s.version !== 1 || s.module !== 'narration' || !Array.isArray(s.tiles) || s.tiles.length !== 6) return ['Provide six narration lines.'];
  if ((s.voice !== 'auto' && !(narrationVoices as readonly string[]).includes(s.voice)) || !(narrationModels as readonly string[]).includes(s.model)) return ['Choose a supported voice and model.'];
  if (s.assignedVoice !== undefined && !(voiceRotation as readonly string[]).includes(s.assignedVoice)) return ['The assigned voice must be one of the four pool voices.'];
  if (typeof s.instructions !== 'string' || s.instructions.length > maxNarrationInstructions) return [`Voice instructions must be at most ${maxNarrationInstructions} characters.`];
  if (new Set(s.tiles.map(t => t.tileNumber)).size !== 6 || s.tiles.some(t => !Number.isInteger(t.tileNumber) || t.tileNumber < 1 || t.tileNumber > 6)) return ['Tile numbers must be the unique values 1 to 6.'];
  if (s.tiles.some(t => typeof t.text !== 'string' || !t.text.trim() || t.text.length > maxNarrationText)) return [`Each tile needs narration text of 1–${maxNarrationText} characters.`];
  return [];
}
