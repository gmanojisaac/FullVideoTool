# Module 6 — Verified Gemini First Frames

Run `npm run dev` and open http://localhost:5173. Step 6 requires the current complete Step 5 render: twelve zoom-in clips and twelve zoom-out clips. It reads completed MP4s as its only pixel source. Original comic/tile PNGs, focus samplers and browser screenshots do not participate in first-frame extraction.

## Operation

1. Render All Tiles in Step 5.
2. Click **Extract All Frames** in Step 6. Every completed zoom-in clip is decoded sequentially in presentation order. Its last full RGB24 frame is saved losslessly as PNG.
3. A second FFmpeg process independently decodes the original MP4 again. Sharp reopens the PNG as RGB24. Every pixel, channel and RGB SHA-256 is compared. A PNG is ready for Gemini only when this exact comparison passes.
4. Use the format/tile selectors to inspect the zoom-in MP4, authoritative PNG and actual decoded zoom-out start preview. Geometry matching and pixel matching have separate PASS/FAIL labels.
5. **Verify All** repeats independent verification. **Regenerate Selected Tile** recovers only that tile. Individual downloads reject PNGs that failed verification or changed after verification.
6. **Download All First Frames** contains only the twelve verified PNGs. Full lesson packaging is Module 7.
7. **Generate Bridge** creates an optional still hold, default 0.3s/9 frames. It does not modify the PNG. A generated loop ending in a different pose can still require a short dissolve.

The whole decode is consumed; the implementation does not seek to duration minus one frame. FFprobe's per-frame presentation timestamps identify the actual selected frame. Decoder buffers retain only first, last and working RGB frames, so memory stays bounded as video duration increases. The RGB24 pipeline uses passthrough frame timing and explicit `accurate_rnd+bitexact` conversion flags. Extraction and verification use distinct child processes with recorded identifiers. MP4s must be H.264/yuv420p, silent, 30 fps and the correct resolution. Missing/corrupt media, empty/incomplete decoding, invalid timing, changed checksums and inconsistent camera manifests are rejected.

Official references: [FFmpeg frame timing](https://ffmpeg.org/ffmpeg.html), [FFprobe frame metadata](https://ffmpeg.org/ffprobe.html), [RGB conversion flags](https://ffmpeg.org/ffmpeg-scaler.html).

## Files

Generation root: `data/exports/<project-id>/frame-runs/<generation-id>/`

- `mobile/gemini_frames/mobile_tile_01_gemini_first_frame.png` through tile 06
- Equivalent desktop PNGs under `desktop/gemini_frames/`
- `mobile/validation_previews/mobile_tile_01_zoom_out_start.png` and desktop equivalents
- Optional bridge MP4s under `<format>/optional_bridges/`
- `metadata/frame_validation_report.json`

Mobile PNGs are 1080×1920; desktop PNGs are 1920×1080. The report includes selected frame index/PTS, dimensions, source MP4 hashes, PNG file hash, both independent RGB hashes, exact pixel difference statistics, geometry/pixel continuity results, decoder identifiers, warnings and timestamps. Saved camera files and original MP4s are preserved. Bridge settings persist in project metadata. Job state, results and downloads survive service restart.

The expected exact match is PNG RGB versus the last decoded frame of its completed source MP4. Independently compressed zoom-in/out clips can differ in pixels even when their camera geometry matches. Those differences are accurately marked FAIL for exact pixel equality and explained as a handoff warning; they do not invalidate an exactly verified authoritative PNG.

## Tests and samples

`npm run test:module6` executes nineteen acceptance scenarios plus RGB difference-statistics checks. Tests change a PNG pixel and confirm rejection/recovery, reject corrupt/missing MP4s, prove the selected frame is beyond the last keyframe, verify all twelve PNG names/hashes, generate a bridge and restore a fresh service. It also runs the twenty Module 5 API scenarios with earlier regressions. `npm test` runs all service/unit suites sequentially. `npm run test:ui` exercises real extraction, independent verification, downloads, optional bridge, changed-file failure/recovery, cancellation and responsive controls.

The Step 6 bench shows actual outcomes. Evidence persists in `previews/module-six-report.json`, service/browser logs and screenshots. Diagnostic processing uses temporary projects. Generate your actual sample with `npm run first-frames -- 03080222-5f86-4423-a624-07ae2ec0698f`; add `--verify` to recheck or `--bridge` to generate a mobile tile 1 bridge. Its completed report is recorded in `previews/module-six-sample-report.json`.

## Changed files

Executed Module 6 service/unit checks: **21 passed, 0 failed**, including all nineteen acceptance scenarios. Actual sample: twelve exact PNG/video RGB matches with zero differing pixels and twelve geometry matches. Separately encoded zoom-out RGB frames differ for all twelve sample pairs; this is recorded accurately rather than treated as an exact match. Sample generation ID: `ee27a0c5-1605-4458-8e89-63c311c0e7cd`; source camera render: `e54d8582-3ee5-4def-ba92-9391f5b3396c`.

Created: `shared/frames.ts`, `server/frame-decode.ts`, `server/frames.ts`, `server/frame-checks.ts`, `src/components/FrameStep.tsx`, `scripts/generate-frames.ts`, `tests/module-six.test.ts`, `tests/browser/frames.spec.ts`, this document and generated evidence.

Updated: `server/app.ts`, `src/components/AnimationStep.tsx`, `src/App.tsx`, `src/styles.css`, `package.json`, `README.md`, development service labels.

No Gemini API calls, emotional loops, audio, voice-over placement or Clipchamp automation are included.
