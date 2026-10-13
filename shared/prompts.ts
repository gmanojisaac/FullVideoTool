export interface TilePrompt { tileNumber: number; motion: string }
export interface MotionPromptSet { version: 1; module: 8; projectId: string; updatedAt: string | null; tiles: TilePrompt[] }

export const maxMotionLength = 600;
export const promptGuardrails = 'Use the supplied first-frame image exactly as the starting frame. Keep the camera completely locked, with no pan, zoom or cut. Preserve the character’s identity, face, proportions, hair, clothing, objects, furniture, background, lighting, perspective and framing. Do not add characters, props, captions, logos, speech bubbles, subtitles or speech. No lighting change and no exaggerated emotion. Subtle, natural, realistic movement only.';
export const defaultMotion = [
  'He breathes slowly and evenly; his chest rises and falls a little. A faint, thoughtful shift of the eyes, then a calm blink.',
  'A quiet, slightly tired exhale. His hand rests on his shoulder and his head tilts a few degrees as he gazes out; curtains stir very gently.',
  'He looks into the middle distance, pensive. His fingers shift slightly and a soft breath is released; steam rises gently from the cup.',
  'A slow blink and a faint movement of his thumb on the phone screen; his gaze stays lowered. Small, natural breathing.',
  'He pours the water steadily and slowly; the water level rises a little. His gaze follows the glass and the curtain moves very slightly.',
  'A calm, settled expression. A slow breath out as he looks toward the horizon; a very light breeze moves his shirt and hair.',
];
export function defaultPromptSet(projectId: string): MotionPromptSet {
  return { version: 1, module: 8, projectId, updatedAt: null, tiles: defaultMotion.map((motion, i) => ({ tileNumber: i + 1, motion })) };
}
export function validatePromptSet(s: MotionPromptSet): string[] {
  if (!s || s.version !== 1 || s.module !== 8 || !Array.isArray(s.tiles) || s.tiles.length !== 6) return ['Provide six tile prompts.'];
  if (new Set(s.tiles.map(t => t.tileNumber)).size !== 6 || s.tiles.some(t => !Number.isInteger(t.tileNumber) || t.tileNumber < 1 || t.tileNumber > 6)) return ['Tile numbers must be the unique values 1 to 6.'];
  if (s.tiles.some(t => typeof t.motion !== 'string' || !t.motion.trim() || t.motion.length > maxMotionLength)) return [`Each tile needs a motion description of 1–${maxMotionLength} characters.`];
  return [];
}
export const assemblePrompt = (motion: string) => `${motion.trim()}\n\n${promptGuardrails}`;
export function promptsText(s: MotionPromptSet, title: string) {
  const parts = [`${title}`.trim(), 'GEMINI MOTION PROMPTS', 'Use each prompt with its matching gemini_frames/tile_NN_first_frame.png (mobile 9:16 or desktop 16:9). The same prompt applies to both formats.'];
  for (const t of [...s.tiles].sort((a, b) => a.tileNumber - b.tileNumber)) parts.push(`--- Tile ${String(t.tileNumber).padStart(2, '0')} ---\n${assemblePrompt(t.motion)}`);
  return parts.filter(Boolean).join('\n\n') + '\n';
}
