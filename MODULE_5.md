# Module 5 — Camera Animation

Start `npm run dev` and open http://localhost:5173. Steps 1–4 remain intact. Step 5 reads all twelve saved focus configurations and their current extraction/layout identifiers. No source crops or approved camera settings are changed by rendering.

## Setup and operation

Node.js 20.19+ is required. Install FFmpeg and FFprobe on PATH, set `FFMPEG_PATH` and `FFPROBE_PATH` to absolute executable paths, or put both executables in `.tools/ffmpeg/bin`. This workspace contains the portable Windows FFmpeg 9.0.2 essentials build from https://www.gyan.dev/ffmpeg/builds/. Both tools are detected and their versions recorded. Missing tools show actionable setup instructions; no fallback renderer is used.

1. Save the six panels, extract the source tiles, and generate both grids.
2. Save Step 4 framing or generate its provisional previews. Review each format independently.
3. In Step 5 choose format/tile and global or individual timing. Timing autosaves. Individual mode initially copies the global settings to six independently editable tile timings.
4. **Preview** renders one actual camera-cycle MP4. **Render Selected Tile** creates that preview plus two transition MP4s. **Render All Tiles** creates all 24 transitions and both full lesson previews.
5. Play the actual MP4, download the selected clips, or expand the complete file list. Cancel stops the worker/FFmpeg; incomplete files cannot be downloaded. Retry creates a new run and preserves completed runs.

Default timings: initial grid 1.5s, zoom in 1.2s, focused placeholder 1s, zoom out 1s, intermediate grid 0.5s and final grid 2s. Detail handoffs default to 0.3s each. Grid holds occur in previews. Zoom-in clips contain the motion, optional detail handoff and placeholder focused hold. Zoom-out clips contain the reverse optional detail handoff and reverse motion. Narration timing is not attached.

## Geometry and encoding

Each format uses its own full reconstructed grid and saved Module 4 view. Native paths interpolate camera centre with cubic smoothstep and camera scale logarithmically. Motion has `round(duration × 30)` frames and uses inclusive `i/(N−1)` endpoints. Different in/out durations sample the same curve in opposite directions. The Module 4 bilinear pixel-centre sampler generates the actual encoder input, including exact intended endpoints. Native out-of-grid transforms are rejected. Existing grid FIT padding is part of the source image.

Reframed Detail performs a real native zoom followed by an explicit smoothstep dissolve to the separately saved tile-pixel view. It reverses that handoff before zoom out. Its files and manifest identify detail mode; it is never described as a continuous native camera move.

FFmpeg receives RGBA frames through a pipe and safe argument arrays (`shell: false`). A separate worker process keeps the API responsive. Clips and lesson previews share generated camera frames. Encoding uses libx264, CRF 18, fast preset, 30 fps CFR, yuv420p, BT.709 conversion metadata, no audio and MP4 faststart. There is no deliberate artwork colour adjustment. FFprobe decodes/counts every output before publication. H.264 is lossy: separately encoded endpoints are not claimed to have identical RGB pixels.

## Files and persistence

Run root: `data/exports/<project-id>/animation-runs/<render-id>/`

- `mobile/transitions/mobile_zoom_to_tile_01.mp4` through `_06.mp4`
- `mobile/transitions/mobile_tile_01_to_grid.mp4` through `_06_to_grid.mp4`
- Corresponding desktop transition filenames under `desktop/transitions/`
- `mobile_lesson_preview.mp4`, `desktop_lesson_preview.mp4`
- `metadata/camera_animation_manifest.json`

One-tile previews use `<format>_tile_01_animation_preview.mp4`. Settings persist at the project's `metadata/animation_settings.json`. Durable job files track progress and interrupted jobs are marked failed after restart. The manifest snapshots all twelve camera views, exact start/end transforms, source hashes, timings, frame counts, codec/probe results, per-file FFmpeg argument arrays and output hashes. It retains enough information to regenerate the camera path. Completed old runs remain accessible by their original download links.

## Tests

`npm run test:module5` runs twenty acceptance scenarios plus timing and missing-tool tests. Tests render all 26 full-resolution outputs with compact timings. They decode video timestamps, verify exact frame counts, compare decoded endpoints to the saved sampler using an explicit lossy-codec tolerance (RGB MAE below 5), check reverse geometry/bounds and run Module 1–4 API regression scenarios. `npm test` runs every earlier service/unit suite sequentially. `npm run test:ui` covers actual playback, download/range responses, timing persistence, detail labels, cancellation/retry and responsive controls, plus earlier browser tests.

Step 5's test bench displays actual PASS/FAIL results with completion time. Test reports persist at `previews/module-five-report.json`; log files record execution. Diagnostic renders use temporary workspaces rather than modifying the active project.

Sample rendering: `npm run render-animations -- 03080222-5f86-4423-a624-07ae2ec0698f --defaults`. The script records the actual completed sample manifest in `previews/module-five-sample-manifest.json`.

## Changed files

Executed before Module 6 development: Module 1–4 baseline **72 passed, 0 failed**; complete Module 1–5 service/unit run **95 passed, 0 failed**; six Module 5 browser scenarios **6 passed, 0 failed**. Build passed. Logs: `previews/module-five-baseline-tests.log`, `previews/module-one-through-five-tests.log`, `previews/module-five-browser-tests.log`. The actual twenty-case report is `previews/module-five-report.json`.

`shared/animation.ts`; `server/animation-jobs.ts`, `server/animation-render.ts`, `server/animation-worker.mjs`, `server/video-tools.ts`, `server/animation-checks.ts`, `server/app.ts`; `src/components/AnimationStep.tsx`, `src/components/FocusStep.tsx`, `src/App.tsx`, `src/styles.css`; `scripts/render-animations.ts`, `scripts/dev.ts`; `tests/module-five.test.ts`, `tests/browser/animation.spec.ts`; `package.json`, `vite.config.ts`, `.gitignore`, `README.md`, this document, and generated evidence in `previews/`.

Rendering speed depends on CPU and output length. The existing focus suggestion remains an unverified centre fallback; review faces, hands and meaningful objects manually. Module 5 does not create Gemini PNGs, loops, audio, Clipchamp timelines or a final asset ZIP.
