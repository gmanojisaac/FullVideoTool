# Module 10 — Automatic lesson assembly

Run `npm run dev` and open http://localhost:5173. In **Step 10 — Assemble Final Lesson**, open a saved project with all camera clips and twelve current verified PNGs. The existing React/TypeScript, Node/Sharp and FFmpeg architecture is preserved.

Upload six MP4/MOV/WebM Gemini videos separately for each format and six MP3/WAV/M4A/AAC narration files shared by both formats. Media is streamed to disk, fully decoded for readability, and inspected with FFprobe. Narration duration comes from the actual gapless 48 kHz stereo PCM sample count. Imported video's audio is muted. Originals are retained unchanged.

Choose each usable loop segment; the default is forward repetition. Review its first/last frames, approximate alignment, RGB differences and global grayscale SSIM against the verified reference. **Review selected loop · 3 repeats** produces an actual lower-resolution MP4. Crossfade and ping-pong are optional. Endpoint similarity does not establish seamless motion; inspect gestures and reversed actions yourself. FIT normalization preserves aspect ratio and can add padding.

Missing video requires **Use Still Frame**. Missing narration requires an explicit silent override and duration. Render buttons stay disabled until required inputs are resolved. These overrides are written into the timeline and warnings. No video, voice, music or captions are generated automatically.

Narration starts at focused-motion entry. Optional lead-in/out add silence within that interval. Camera clips retain their original frame counts, including the saved incoming placeholder hold. Intro/intermediate/outro holds default to 1.5/0.5/2 seconds; intermediate holds can be overridden per tile. A narration of 8.4 seconds uses 403,200 audio samples and 252 motion frames. Nonintegral durations round visual coverage up, preserving every intended narration sample. Per-tile gain is capped below clipping without compression or speech speed changes.

Use **Preview / render selected tile**, complete lower-resolution preview, mobile, desktop or both. Progress and cancellation apply to accepted jobs; retry retains previous valid outputs and reuses hashed segment caches. Camera and lesson jobs share admission controls so FFmpeg processes remain bounded. Files are written temporarily and promoted after actual probing and complete video/audio decoding.

Final MP4: mobile 1080×1920 or desktop 1920×1080, H.264/yuv420p/constant 30 fps, AAC/48 kHz/stereo. Each run lives at `data/exports/<project>/assembly/runs/<render>/`, containing `final_videos/`, `metadata/lesson_timeline.json`, `lesson_render_manifest.json` and `final_video_validation.json`. Both finished formats remain available when rendered separately with identical current inputs. Historical validated files remain in their original run directories.

The editing ZIP includes available final videos, original narration and imported loops, 24 camera transitions, two grids, twelve verified PNGs, source/configuration snapshots and a frame/sample-based edit decision list. It is reopened and checksummed before download. Import the MP4 directly into Clipchamp, or use the original assets and EDL to rebuild/edit it. This is not a native Clipchamp timeline project.

Commands:

```powershell
npm run test:unit
npm run test:module10
npm run test:e2e
npm run assemble-lesson -- <project-UUID> both
```

`test:module10` executes 24 real media checks followed by every available earlier regression suite. Module 8 is unavailable pending the rest of its specification; unrun checks are never counted as passed. Results appear in the Step 10 test panel and `previews/module-ten-report.json`. See `TEST_REPORT.md` for actual executions and retained failure logs.

The supplied-comic demo uses explicit authoritative still-frame fallbacks and labeled synthetic sine test tones. It demonstrates timing/export, not Gemini motion or spoken narration. Import your actual external clips and voice-over, inspect continuity, and render again for the finished lesson.

Actual results: 25/25 Module 10 acceptance cases PASS; 154 available earlier regression tests PASS; 11 ZIP/timing/job/storage units PASS; all 38 distinct browser checks PASS across the suite and corrected cancellation rerun. Some unit/regression checks overlap, so these counts are not added into a purported unique total. TypeScript and production build PASS. Failure logs and corrections remain documented in `TEST_REPORT.md`. Full application acceptance remains partial because Module 8 and its dependent Module 9 prompt workflow are pending. Native Clipchamp import and external Gemini motion quality were not manually tested.

Open the retained sample at [Step 10](http://localhost:5173/?project=03080222-5f86-4423-a624-07ae2ec0698f#assemble-lesson). Both finished videos are 36.6 seconds / 1,098 frames, with decoded stream validation PASS:

- [Mobile MP4](data/exports/03080222-5f86-4423-a624-07ae2ec0698f/assembly/runs/8f0e47b7-13e5-4f45-a7ed-07d2ff895822/final_videos/lesson_mobile_9x16.mp4)
- [Desktop MP4](data/exports/03080222-5f86-4423-a624-07ae2ec0698f/assembly/runs/8f0e47b7-13e5-4f45-a7ed-07d2ff895822/final_videos/lesson_desktop_16x9.mp4)
- [Frame/sample timeline](data/exports/03080222-5f86-4423-a624-07ae2ec0698f/assembly/runs/8f0e47b7-13e5-4f45-a7ed-07d2ff895822/metadata/lesson_timeline.json)
- [Render validation](data/exports/03080222-5f86-4423-a624-07ae2ec0698f/assembly/runs/8f0e47b7-13e5-4f45-a7ed-07d2ff895822/metadata/final_video_validation.json)
- [52-entry editing ZIP](data/exports/03080222-5f86-4423-a624-07ae2ec0698f/assembly/runs/8f0e47b7-13e5-4f45-a7ed-07d2ff895822/lesson_editing_assets.zip)
- [Actual browser screenshot](previews/module-ten-sample-output.png), [browser evidence](previews/module-ten-sample-browser.json), [consolidated results](previews/application-validation.json)

To test manually, open the sample and play both finished outputs. Replace the test tones with six recorded narrations. For each format, upload its six external clips and clear the corresponding still fallback, select the usable loop in/out range, and inspect **Review selected loop · 3 repeats**. Preview a tile, inspect its narration start and handoffs, then render both formats and download the timeline and ZIP. Cancel a new render and retry; the previously completed videos stay available. Reopen the project to check saved settings. To rerun the reproducible demo, use `node node_modules/tsx/dist/cli.mjs scripts/assemble-sample.ts`; it deliberately installs test-tone narration and selects all still fallbacks on the sample project.

Created: `shared/assembly.ts`; `server/assembly-media.ts`, `assembly-quality.ts`, `assembly-render.ts`, `assembly.ts`, `assembly-checks.ts`, `assembly-regression.ts`; `src/components/AssemblyStep.tsx`; `scripts/assemble-lesson.ts`, `assemble-sample.ts`, `run-assembly-regressions.ts`, `validation-summary.ts`, `capture-assembly-demo.ts`; `tests/module-ten.test.ts`, `assembly-timeline.test.ts`, `assembly-jobs.test.ts`, `storage.test.ts`, `browser/assembly.spec.ts`, `browser/smoke.spec.ts`; this guide.

Modified: `server/app.ts` (routes/admission), `project-management.ts` (stage 10 and media duplication), `assets.ts` (assembly assets), `export-zip.ts` (bounded metadata chunks), `storage.ts` (bounded Windows lock retry and temporary cleanup), `frames.ts` (startup failure rollback); `src/App.tsx`, `styles.css`, `components/ProjectManager.tsx`, `AnimationStep.tsx`, `FrameStep.tsx`, `ExportStep.tsx` (integration/cancellation/overflow fixes); `package.json`; `README.md`, `TEST_REPORT.md`, `USER_WORKFLOW.md`, `MODULE_7.md`. Generated demo/test reports and screenshots are under `previews/`; media and durable manifests are under `data/`. Module 11 is outside this implementation.
