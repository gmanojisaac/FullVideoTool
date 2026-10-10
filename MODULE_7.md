# Module 7 — Clipchamp package

Run `npm run dev`, open http://localhost:5173 and reopen your project. Render all camera clips and extract/verify twelve first-frame PNGs. In **Export for Clipchamp**, enter the project name and lesson title, then export mobile, desktop or the complete package. Current files are inspected and decoded before the archive becomes downloadable. Cancel retains earlier completed packages.

`npm run test:module7` executes twenty acceptance cases plus their parent test. The actual standalone run passed 21 tests, zero failed or skipped, in 334 seconds. Its JSON report is `previews/module-seven-report.json`; the log is `previews/module-seven-tests.log`. Later integration changes require their own regression run.

Each ZIP has `six_tile_lesson_export/` containing source, six extracted PNGs, selected mobile/desktop grids, transitions, previews, Gemini PNGs, optional bridges, eight metadata JSON files and two instruction files. A combined package without bridges has 57 entries. JPEG/WebP sources retain their uploaded filename and format; PNG sources use original_comic.png. Payloads are copied without resizing or recompression.

All mandatory MP4s must be MP4/H.264/yuv420p/constant 30 fps/silent, with correct independent format dimensions. All Gemini PNGs are compared again against a new decode of the completed incoming camera video. The validation report names failing files. Optional missing/corrupt bridges are skipped with warnings. Selected-format packages validate only included format media and shared mandatory assets.

ZIP files stream in 64 KB chunks through fflate. A bounded central-directory reader reopens recorded entry ranges and checks size, CRC32 and SHA-256 before atomic promotion. It does not confuse ZIP-like byte sequences embedded inside MP4s with real headers. SHA-256 is checked again during streaming, detecting changes after validation. Paths and duplicate names are rejected. Archives are limited to approximately 4 GB; split formats when necessary. The manifest lists every other payload file. Its own exact hash is recorded in an external verification receipt, avoiding an impossible self-referential hash.

Completed packages: `data/exports/<project>/package-runs/<export>/`. Download ZIP, manifest and receipt from the UI. For a saved project: `npm run export-package -- <UUID> complete`.

Added: shared/export.ts; server/export-validation.ts, export-zip.ts, exports.ts, export-checks.ts; src/components/ExportStep.tsx; scripts/export-package.ts; tests/module-seven.test.ts; this guide. Modified: app, extraction job busy status, App, styles, package scripts. Rendering algorithms remain unchanged by packaging.

Gemini generation and Clipchamp editing are manual. README_CLIPCHAMP documents exact grid still durations and placeholder holds. No native Clipchamp project is generated and no external Gemini loop is claimed seamless.
