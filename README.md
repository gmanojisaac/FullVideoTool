# Six-Tile Lesson Video Builder

A local React/TypeScript application for preparing six-panel Stitch comics, independent mobile and desktop camera videos, verified Gemini starting frames, Clipchamp asset packages and finished lessons assembled from imported video/narration. The existing Node/Express, Sharp and FFmpeg architecture is retained. Processing and project storage stay on this computer.

Modules 1–7 and Module 10 are implemented. Project management, navigation, dependency status, an asset dashboard and a render queue from Module 9 are implemented. Module 8 is pending its remaining specification; Module 9 cannot yet meet its full acceptance. Actual test outcomes and limitations are recorded in TEST_REPORT.md.

## Start on Windows

Requires Node.js 20.19+ and npm, plus FFmpeg and FFprobe. FFmpeg binaries are not included in the GitHub source release. Install both on PATH, place portable `ffmpeg.exe` and `ffprobe.exe` in `.tools/ffmpeg/bin`, or set absolute `FFMPEG_PATH` and `FFPROBE_PATH`, then restart the service. The original portrait comic and derived test fixtures are included in `tests/fixtures`.

```powershell
npm ci
npm run dev
```

Open **http://localhost:5173**. The API is **http://localhost:3001**. Ctrl+C stops both. If a PowerShell npm shim is blocked, use `node 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' run dev`.

Release **1.0.0** ships the source, locked dependency versions, fixtures and documentation. Local projects, render outputs, media imports, test logs and screenshots are generated on your computer and are excluded from Git. See [RELEASE_NOTES.md](RELEASE_NOTES.md) for release scope and verified outcomes.

For the built application:

```powershell
npm run build
npm start
```

Open http://localhost:3001. `npm run server` starts only the API. There is no cloud deployment or user account.

## Workflow

Upload PNG/JPEG/WebP → review numbered boundaries and drag corrections → save project → extract native-resolution tiles → build mobile 1080×1920 and desktop 1920×1080 grids → adjust twelve independent camera views → render H.264/yuv420p/constant 30 fps silent transitions and previews → extract and independently verify actual last displayed video frames → validate and export local packages.

Use the ten-stage navigation and component save/generate controls. Dependencies must exist before a later stage can generate outputs. Earlier stages remain accessible. Project name and optional lesson title are saved locally. Saved projects can be reopened, renamed, duplicated or deleted with confirmation; last visited available stage is persisted. Duplicate projects retain settings and imported assembly media, then regenerate their own outputs. Deleted projects move to `data/trash` for recovery.

Input limits: one still image, 20 MB, 40 megapixels, at least 120×120. Detection uses gutters rather than aspect ratio alone; review uncertain results. FIT preserves artwork with padding; FILL discloses cropping. Camera transforms are saved in source/grid pixel coordinates and use the same deterministic sampler for preview and rendering. Native Camera stays on the grid; Reframed Detail uses an explicitly labelled controlled handoff. Semantic focal detection is currently a disclosed centre fallback requiring manual review.

The frame PNG is extracted from the finished MP4, then checked against a second independent decode. Separate lossy zoom-out pixels can differ despite matching camera geometry. No external Gemini loop is guaranteed seamless. Prompt editing awaits the rest of Module 8. Step 10 accepts twelve external MP4/MOV/WebM loops and six shared MP3/WAV/M4A/AAC narrations, reviews continuity, repeats/trims loops to whole-frame audio coverage, and produces two H.264/AAC lesson MP4s plus editing assets. Missing media requires a deliberate still/silent override. See [MODULE_10.md](MODULE_10.md).

## Commands and tests

```powershell
npm run fixtures
npm run build
npm test
npm run test:unit
npm run test:integration
npm run test:e2e
```

`npm test` and `test:module10` run real assembly media checks, then available earlier service/geometry/integration regressions serially. `test:regression` runs only those earlier regressions; `test:unit` runs ZIP, pure timing, startup admission and interrupted-job recovery tests. `test:e2e` and `test:ui` run Playwright browser tests. `npm run check` runs build, service tests and UI tests. Individual earlier suites: `npm run test:module1` through `test:module7`. Full media suites take several minutes; short camera timings retain required full-resolution decoding.

Saved project CLI commands: `npm run grids -- <UUID>`, `npm run focus-previews -- <UUID>`, `npm run render-animations -- <UUID> --defaults`, `npm run first-frames -- <UUID>` and `npm run export-package -- <UUID> complete`. Use the UI for reviewed settings. Reports record actual outcomes; see [TEST_REPORT.md](TEST_REPORT.md), [INTEGRATION_AUDIT.md](INTEGRATION_AUDIT.md), [USER_WORKFLOW.md](USER_WORKFLOW.md) and individual `MODULE_2.md`–`MODULE_7.md` guides.

## Storage and output structure

```text
src/                         React editor and stage components
shared/                      Versioned schemas and geometry
server/                      Processing, persistence, queue and validation
scripts/                     Development and saved-project CLI tools
tests/fixtures/              Supplied portrait comic and derived fixtures
tests/browser/               Playwright scenarios
data/inputs/                 Retained originals and metadata
data/projects/<UUID>.json     Version 1 project records
data/exports/<UUID>/
  metadata/                  Focus, timing, frame and export settings
  runs/<UUID>/               Native tiles, retained source, extraction manifest
  layout-runs/<UUID>/        Two grids and layout manifest
  focus-runs/<UUID>/         Provisional focus previews
  animation-runs/<UUID>/     24 transitions, two previews and camera manifest
  frame-runs/<UUID>/         12 authoritative PNGs, validation and optional bridges
  package-runs/<UUID>/       Verified ZIP, manifest and external checksum receipt
  assembly/                  Imported media, settings, loop analysis and segment cache
    runs/<UUID>/             Final MP4s, frame/sample timelines, validation and editing ZIP
data/render-queue/           Durable camera job records
data/trash/                  Recoverable deleted projects
previews/                    Actual test reports, screenshots and sample manifests
```

ZIP root is `six_tile_lesson_export/`: source, extracted_tiles, mobile/desktop grids, transitions, lesson previews, gemini_frames, optional_bridges, metadata and two README instruction files. Metadata maps saved source asset names to package paths. Packaging never resizes or recompresses approved assets. Archives stream and are independently reopened and checksum-verified before publication. Maximum ZIP size is approximately 4 GB; split formats for larger packages. The manifest cannot hash itself: its checksum is stored in a separate download receipt.

## Troubleshooting

- Service unavailable: start `npm run dev`, check ports 3001 and 5173, and use localhost/127.0.0.1.
- Missing FFmpeg: install both tools or configure their paths, restart and retry.
- An output becomes unavailable after an edit: regenerate the affected downstream stage. Old completed files remain in their original run directories.
- Interrupted/cancelled render: reopen the saved project and retry. Failed work does not replace prior valid outputs.
- Export failure: inspect the named file and reason. Missing/corrupt mandatory assets block publication; optional bridges can be skipped with a warning.
- Large/long-path errors: shorten the workspace path or reduce input size. Actual limits and untested conditions are recorded in the test report.

The render queue defaults to one camera job (two concurrent FFmpeg encoders). Set `FFMPEG_MAX_PROCESSES` to an even value 2–8 before starting for a larger safe budget; frame/export validation waits for camera work to finish. Encoding threads are bounded. Avoid running multiple full test suites at the same time.
