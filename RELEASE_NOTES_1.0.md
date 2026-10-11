# Release 1.0

Version: **1.0.0**. Released 10 October 2026.

Six-Tile Lesson Video Builder runs locally on Windows using React, TypeScript, Node.js, Sharp and FFmpeg. No paid renderer or cloud service is required.

## Included

- PNG/JPEG/WebP upload, gutter-based 2×3/3×2 detection, numbered guides, draggable corrections and project persistence.
- Six native-resolution tile exports and independent mobile/desktop grid reconstruction with FIT/FILL controls.
- Twelve saved focused views with manual adjustment and deterministic camera transforms.
- Silent H.264 camera transitions and previews, authoritative last-displayed-frame PNG extraction, independent RGB verification and optional bridges.
- Verified Clipchamp asset ZIPs, project management, asset dependency status and a bounded render queue.
- Step 10 lesson assembly: twelve independent imported motion clips, six shared narration tracks, loop selection/repetition, optional crossfades/ping-pong/bridges, audio-driven frame/sample timing, preview/cancel/retry and complete mobile/desktop H.264/AAC MP4 export.
- Timeline/validation manifests, human-readable editing instructions, source fixtures and executable tests.

## Installation

1. Install Node.js 20.19+ and FFmpeg/FFprobe. Put both video tools on PATH or in `.tools/ffmpeg/bin`.
2. Clone or download this release and run `npm ci` in its directory.
3. Run `npm run dev` and open **http://localhost:5173**.
4. For the built app, run `npm run build`, then `npm start`, and open **http://localhost:3001**.

Dependencies, FFmpeg executables, local projects, uploaded media, rendered videos and generated test evidence are excluded from the source release. The supplied comic and derived fixtures are included.

## Executed verification

The implementation was verified before publication:

| Check | Actual outcome |
|---|---|
| Module 10 acceptance | 25/25 PASS; includes the available earlier regression run |
| Available earlier service/geometry/integration regressions | 154 PASS; zero failures/skips |
| ZIP/timing/job recovery/storage units | 11 PASS; zero failures/skips |
| Browser coverage | 38 distinct checks passed across the suite and corrected cancellation rerun |
| Production build | TypeScript and Vite PASS |
| Supplied-comic demo | Both formats decoded and validated; 36.6 seconds / 1,098 frames each |

These counts overlap and are not a unique combined test total. The browser suite initially had one Windows metadata-lock failure; the bounded atomic-write retry and affected cancellation test subsequently passed. Details and retained historical failures are documented in `TEST_REPORT.md`. Evidence and demo media were generated in the original local workspace; a new checkout starts with no saved projects or prepopulated PASS report.

To verify your checkout, run `npm run build`, `npm run test:unit`, `npm run test:module10` and `npm run test:e2e` sequentially. Install Chrome/Edge or Playwright Chromium before browser tests. Full video suites take several minutes. Test results are generated locally and the application displays actual executed PASS/FAIL outcomes.

## Known limitations

- Module 8 awaits the remaining user specification. Complete Module 9 acceptance depends on that prompt workflow.
- Semantic focal detection uses a disclosed image-centre fallback; faces, hands and meaningful objects require manual review.
- External Gemini clips and human narration must be supplied. The retained local demo used explicit verified-still fallbacks and labeled synthetic test tones.
- Separate lossy camera encodes can differ in RGB despite matching geometry. External loop seams and handoffs require visual review; they are not guaranteed seamless.
- MP4 codec/frame/audio characteristics are validated. Native Clipchamp import was not manually exercised, and no native Clipchamp timeline project is generated.

See `USER_WORKFLOW.md` and `MODULE_10.md` for operation and editing instructions. No Module 11 features are included.
