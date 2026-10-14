# Release notes — 14 October 2026

Adds a Remotion-based lesson composition, a four-voice round-robin narration generator with loudness normalisation, and
related fixes. Builds on the branch `feature/prompts-narration-cinematic-camera` (pull request #1). Not tagged;
`package.json` still reports 2.0.0.

## New

### Remotion composition (`remotion-poc/`, isolated)
- One composition renders both 9:16 (1080×1920) and 16:9 (1920×1080) from a `data.json`.
- Per panel: the camera zooms from the full grid into the panel, a character loop plays once it settles, then the camera
  **pulls back to the full set of tiles** (36 frames) with a short grid hold before the next panel starts from that exact
  state. Nothing cuts or cross-fades between tiles.
- Below the card: word-lit captions, key-phrase chips and a voice-reactive SVG wave driven by the narration's loudness.
- Typed title card, progress ring, timecode and progress bar, glow background and corner brackets.
- `prepare-image.ts`: detects panels with the existing detector, upscales the photo for a smoother move, **crops each
  panel automatically**, generates loops, and measures narration length and loudness per frame.
- Loops: placeholder "breathing" drift by default; `--loops <folder>` accepts real clips (for example Gemini output),
  cropped to the card so the first frame matches the still.

### Four-voice round-robin narration (OpenAI text-to-speech)
- Voices **coral → nova → shimmer → sage → coral…**, one turn per video created; the position is stored in
  `data/narration_rotation.json` and survives restarts. A failed attempt does not use up a turn; re-takes of a single
  tile keep the video's voice.
- Natural delivery: each clip is sent with the author's style line, a distinct character for the chosen voice, natural-
  prosody guidance (pitch and pace variation, pauses at punctuation, soft breaths, no exaggerated acting) and a hint for
  its position (gentle opening, settling close).
- Loudness normalisation to **−16 LUFS** with a constant gain and a peak limiter, so the voice's own modulation is kept.
  Raw OpenAI clips arrived at about −29 LUFS and varied by 3 dB between tiles.
- `scripts/generate-voiceover.ts` for the Remotion pipeline (`--dry-run`, `--normalize-only <dir>` to fix existing
  clips without an API call); the in-app Narration panel gains a **Voice → Auto** option.

## Fixes
- **Placeholder environment variable shadowing `.env`.** A leftover `OPENAI_API_KEY=sk-...` in the Windows environment
  overrode the real key in `.env`, giving a 401. The loader now treats an obvious placeholder (empty, `...`, `<…>`,
  under 20 characters) in `*_API_KEY`/`*_TOKEN`/`*_SECRET` as absent and uses `.env`. Real values still take priority.
- Remotion composition: caption words had no spaces (CSS shorthand), tile cards showed dark margins (fixed by the
  automatic crop), and a use-before-declaration error that failed full renders (found with stills across all scenes).

## Verification actually performed
| Check | Result |
|---|---|
| `tsc --noEmit` | Clean |
| `npm run test:unit` | 45/45 pass (new: rotation, delivery instructions, fixed voice, failed attempt, key redaction, loudness) |
| OpenAI key | Accepted; real speech generated for six clips with coral |
| Narration after normalisation | −16.2 LUFS in the final video (was −29.4); speech onsets within about 20 ms of the original render |
| Mobile video | 1080×1920, 80.8 s, 2,424 frames, H.264 + AAC; reviewed frame by frame: intro, six moments, loop and wave, pull-backs |
| Loop first frame vs still | About 42 dB PSNR on all six (no visible pop) |

## Not verified / limits
- **The voice has not been listened to.** Pause counts and levels were measured, tone and naturalness were not. Pace
  tends to speed up slightly toward the last tiles despite the instruction to slow down.
- Loops are placeholders (zoom and sway), not character emotion. The voice wave is a graphic, not character motion.
- Caption highlighting is estimated from word length and punctuation, not aligned to the audio.
- The 16:9 render on file predates the loop and wave; it was not re-rendered.
- Playwright UI tests and module regression suites were not re-run.
- OpenAI account has auto-reload off; the API stops at a $0 balance.
- Remotion licence: free for individuals and up to three employees; otherwise a company licence is required.

## Files
**New:** `remotion-poc/` (composition, preparer, README, lockfile), `scripts/generate-voiceover.ts`.
**Changed:** `server/narration.ts`, `server/load-env.ts`, `shared/narration.ts`, `src/components/NarrationStep.tsx`,
`tests/narration.test.ts`, `.gitignore`.
