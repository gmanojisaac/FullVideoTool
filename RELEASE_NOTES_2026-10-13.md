# Release notes — 13 October 2026

Covers the work done on 12–13 October 2026 on top of Release 2.0.0. These changes are on branch `feature/prompts-narration-cinematic-camera` and are **not tagged or versioned**; `package.json` still reports 2.0.0.

## Summary

The project was set up from `gmanojisaac/FullVideoTool`, run end to end on a real comic (six panels, `1.webp`), and the gaps found along the way were closed: the Step 8 prompt editor was a placeholder, Step 10 had no quick way to render before real media exists, and there was no voice-over generator or Three.js camera.

## New features

### Step 8 — Gemini motion prompts (was a placeholder)
- One editable motion description per tile (1–600 characters), with the tile's verified first frame shown beside it.
- Fixed safety instructions are appended automatically: locked camera, preserve identity/clothing/lighting/framing, no added characters, text or speech.
- Save, reset to default, copy full prompt, and download all prompts as one `.txt`.
- Saved prompts appear as **Ready** in the asset dashboard (they were permanently *Missing*) and are bundled into the export ZIP as `prompts/gemini_motion_prompts.txt`. The export fingerprint includes them, so an export is marked stale when prompts change.
- API: `GET/PUT /api/projects/:id/motion-prompts`, `GET /api/projects/:id/motion-prompts.txt`.

### Step 10 — render before real media exists
- **Use stills and silence for all missing media**: one button replaces 24 manual checkbox clicks. It only touches tiles with no imported Gemini video or narration, in both formats, with an adjustable placeholder duration.

### Optional narration voice (OpenAI text-to-speech)
- New **Narration voice** panel above Step 10: one line per tile, voice and model choice, delivery instructions (gpt-4o models), per-tile and all-six generation.
- Generated WAVs go through the same validated import as uploaded narration, so segment timing re-fits to the audio length.
- **Opt-in and local-first:** nothing is sent until Generate is pressed. The API key comes only from the `OPENAI_API_KEY` environment variable, is never stored, logged or returned, and is redacted from error messages.
- `.env` support: `server/load-env.ts` loads a project-root `.env` at startup (a real environment variable still wins). `.env` is git-ignored; `.env.example` is tracked.
- API: `GET/PUT /api/projects/:id/narration`, `POST /api/projects/:id/narration/generate`.

### Optional cinematic camera (Three.js)
- New **Camera movement** selector in Step 10: *Classic* (default, flat zoom, pixel-exact) or *Cinematic* (Three.js).
- Cinematic uses a perspective camera with an eased arc, a few degrees of tilt, and a focused tile that lifts off the grid with a soft shadow for parallax. Faces are not distorted.
- Hybrid by design: only the zoom portion of each transition (36 frames) is rendered with Three.js. The dissolve and focused-hold frames come from the verified classic clip, and both ends land exactly on the saved framing, so the Gemini first frames, narration timing and total frame count are unchanged.
- Rendered headlessly through the local Chrome/Edge (as the 3D text effects already are) at fixed timestamps, then spliced with FFmpeg.
- Takes roughly 30 s per transition (about 15 minutes for both formats).

## Changed behaviour
- Asset dashboard no longer carries the "Module 8 specification is incomplete" warning.
- `/api/health` reports that Module 8 prompt authoring is implemented.
- `ExportContext` carries optional `prompts`; `AssemblyConfig` carries optional `cameraEngine`. Both are optional, so existing saved projects load unchanged.
- `README.md` and `USER_WORKFLOW.md` updated for Step 8, narration voice and camera movement.
- `.gitignore` now ignores `output/` (generated deliverable videos).

## Verification actually performed

| Check | Result |
|---|---|
| `tsc --noEmit` | Clean |
| `npm run test:unit` | 35/35 pass (new: 4 prompts, 3 narration, 5 cinematic camera; 23 existing) |
| Full pipeline on the sample comic | Upload → panels → tiles → grids → framing → camera → first frames (12/12 verified) → export (58 files, ZIP checksums PASS) → lesson render |
| Final lesson videos | 1080×1920 and 1920×1080, 2,792 frames, 93.07 s, H.264/AAC, decoded and validated; audio level checked non-silent |
| Cinematic vs classic | Same frame count and duration; side-by-side frame sheets reviewed; no visible jump at the Three.js/classic join |

## Not verified / known limitations
- **OpenAI generation was not run against the real service** (no key was available). It is tested with a fake speech service only. The first live call may need small adjustments.
- **Cinematic camera was judged from still frames**, not watched in motion; arc strength may want tuning.
- The existing browser (Playwright) and module regression suites were **not re-run** this session.
- Narration used in the sample renders is a local Windows TTS placeholder reading six lines written for the demo; the motion clips are a looping FFmpeg push-in labelled `*_local_drift_placeholder.mp4`, **not Gemini output**.
- Tile-to-tile travel (without returning to the grid) and the other effects in the Three.js guide (particles, lighting, masks, post-processing) are not built.

## Observations worth a follow-up
- In Step 4, the mouse wheel over the framing canvas zooms the camera and **autosaves**, so an accidental scroll silently changes a saved view.
- The camera-mode dropdown can show the previous tile's value after switching tiles in some sequences; the saved value then differs from what is displayed. Seen during scripted use and not investigated.

## Sample project settings used (not code)
All 12 framing views were switched to *Reframed Detail* so the first frame given to Gemini contains only the target panel, without slices of neighbouring panels. This is project data, not a default change.

## Files

**New:** `shared/prompts.ts`, `shared/narration.ts`, `shared/cinematic.ts`, `server/prompts.ts`, `server/narration.ts`, `server/load-env.ts`, `server/cinematic-browser.ts`, `server/cinematic-render.ts`, `src/components/MotionPromptStep.tsx`, `src/components/NarrationStep.tsx`, `tests/prompts.test.ts`, `tests/narration.test.ts`, `tests/cinematic.test.ts`, `.env.example`, this file.

**Modified:** `server/app.ts`, `server/assets.ts`, `server/export-validation.ts`, `server/assembly-render.ts`, `server/index.ts`, `scripts/dev.ts`, `shared/export.ts`, `shared/assembly.ts`, `src/App.tsx`, `src/components/AssemblyStep.tsx`, `src/styles.css`, `package.json`, `.gitignore`, `README.md`, `USER_WORKFLOW.md`.
