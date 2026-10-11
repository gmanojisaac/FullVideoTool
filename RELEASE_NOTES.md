# Release 2.0

Version: **2.0.0**. Release date: 11 October 2026. Tag: **v2.0.0**.

Six-Tile Lesson Video Builder runs locally on Windows using React, TypeScript, Node.js, Sharp and FFmpeg. No paid renderer or cloud service is required.

## New in 2.0

- Optional **3D Text Effects** editor integrated into Step 10, with real extruded font geometry and Particle assembly, Camera fly-through and Environmental 3D text presets.
- Independent text objects with editable fonts, spacing, alignment, depth, bevel, physical materials, transforms, layer order, start time, animation duration, completed hold and optional fade-out.
- Transparent Three.js canvas over assembled camera/Gemini footage with synchronized narration, play/pause/restart/scrub, both output formats and lower-quality preview.
- Deterministic seeded, frame-index rendering at 30 fps. A one-second animation exports exactly 30 full-resolution RGBA PNGs with verified filenames, checksums and ZIP manifest.
- Local HDR reflections, alpha-preserving bloom, a lossless alpha-video layer and final FFmpeg MP4 compositing that preserves existing narration packets and source assets.
- Versioned, backward-compatible assembly settings; save/reopen/duplicate, export progress, cancellation, retry, interruption recovery and bounded GPU resource cleanup.
- Updated tests, font/library notices, technical documentation and manual acceptance checklist. New asset export manifests identify application version 2.0.0; data schema versions remain compatible.

See [TEXT_EFFECTS.md](TEXT_EFFECTS.md), [integration and changed files](TEXT_EFFECTS_INTEGRATION.md), and [actual text-effect test outcomes](TEXT_EFFECTS_TEST_REPORT.md). Earlier release notes are preserved in [RELEASE_NOTES_1.0.md](RELEASE_NOTES_1.0.md).

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

Text export also requires local Chrome/Edge with WebGL 2 or locally installed Playwright Chromium. `TEXT_CHROME_PATH` can select an absolute browser executable path. Rendering does not download a browser or use a cloud service.

Dependencies, FFmpeg executables, local projects, uploaded media, rendered videos and generated test evidence are excluded from the source release. The supplied comic and derived fixtures are included.

## Executed verification

The implementation was verified before publication:

| Check | Actual outcome |
|---|---|
| Module 10 acceptance | 26/26 PASS; includes the available earlier regression run |
| Available earlier service/geometry/integration regressions | 154 PASS; zero failures/skips |
| ZIP/timing/text/job recovery/storage units | 23 PASS; zero failures/skips |
| Dedicated text/render/compositor suite | 17 PASS, including full-resolution PNGs, cancellation and real API composition |
| Browser coverage | 42 distinct cases have passing evidence: full run 41/42, then the unchanged failed landscape case passed its focused rerun |
| Production build | TypeScript and Vite PASS |
| Full text-enabled composition | Both 1080×1920 and 1920×1080 outputs decoded/validated; exact onset and unchanged AAC packet hash checked |

These counts overlap and are not a unique combined test total. The dedicated text suite preceded one additional media-timestamp unit check, which passed in the final 23-test unit run. The final full browser run encountered one transient local proxy timeout loading the landscape image (HTTP 500); the endpoint subsequently returned HTTP 200 and the unchanged case passed its focused rerun. Earlier seek-rounding and WebGL-alpha issues were corrected and retested. Details are in `TEXT_EFFECTS_TEST_REPORT.md`; historical 1.0 outcomes remain in `TEST_REPORT.md` and `RELEASE_NOTES_1.0.md`. Automated media checks use explicitly labeled synthetic footage/narration stand-ins and the supplied comic. A new checkout starts with no saved projects or prepopulated PASS report.

To verify your checkout, run `npm run build`, `npm run test:unit`, `npm run test:text`, `npm run test:module10` and `npm run test:e2e` sequentially. Install Chrome/Edge or Playwright Chromium before browser/media tests. Full video suites take several minutes. Test results are generated locally and the application displays actual executed PASS/FAIL outcomes.

## Known limitations

- Module 8 awaits the remaining user specification. Complete Module 9 acceptance depends on that prompt workflow.
- Semantic focal detection uses a disclosed image-centre fallback; faces, hands and meaningful objects require manual review.
- External Gemini clips and human narration must be supplied. The retained local demo used explicit verified-still fallbacks and labeled synthetic test tones.
- Separate lossy camera encodes can differ in RGB despite matching geometry. External loop seams and handoffs require visual review; they are not guaranteed seamless.
- MP4 codec/frame/audio characteristics are validated. Native Clipchamp import was not manually exercised, and no native Clipchamp timeline project is generated.
- Eight secondary text effects have extension hooks only. Depth of field, actual volumetric scattering and refraction of footage through glass are not implemented.
- Reflections support local Radiance `.hdr` assets; EXR/custom font upload are not supported. Bundled fonts reject unsupported glyphs explicitly. Repeatability across different GPUs/browser versions is not promised.
- The Three.js/font engine is loaded on demand and produces a large-chunk build advisory. The existing Sharp/libvips dependency audit advisory is documented; an unrelated major upgrade is not included.

See `USER_WORKFLOW.md`, `MODULE_10.md` and `TEXT_EFFECTS.md` for operation and editing instructions. The existing six-tile stages and imported-media workflow remain available.
