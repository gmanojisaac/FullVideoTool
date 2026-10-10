# Module 3 — Mobile and desktop grid reconstruction

Run `npm run dev` and open http://localhost:5173. The local API is http://localhost:3001. Node 20.19+ is required. Modules 1–2 use the existing React/TypeScript and Node/Sharp stack and are retained.

## Manual use

1. Upload the comic, correct its boundaries, and **Save project** in Step 1.
2. **Extract Six Tiles** in Step 2. Wait for six verified PNGs.
3. In **Step 3 — Create Mobile & Desktop Grids**, choose FIT (default) or FILL. Configure outer margin, internal gutter, gutter colour, and padding colour.
4. Leave **Common settings for both formats** enabled, or disable it and switch the Mobile/Desktop tabs to configure each separately. Tile positions are always independent for the two formats.
5. With FILL, select a numbered source thumbnail and move Horizontal/Vertical crop position. The warning discloses artwork removal. **Generate Grids** / **Regenerate** applies the position and displays actual exported PNGs.
6. Download both PNGs and the layout manifest. Reopen the saved project to restore settings and generated previews. **Save grid settings** also persists changes before generation; changed settings hide outdated previews until regenerated.
7. Retry failed jobs or cancel an active one. Existing extraction runs, source tiles, and completed grid exports remain preserved. After a service interruption, reopen the project and retry generation.

An already extracted project can be regenerated from the terminal while the service runs:

```powershell
npm run grids -- <project-id>
```

## Geometry and artwork

Mobile is exactly **1080 × 1920**, two columns and three rows, order `1,2 / 3,4 / 5,6`. Desktop is exactly **1920 × 1080**, three columns and two rows, order `1,2,3 / 4,5,6`. Both are independently composed from the same six Module 2 PNGs. The full source comic is never used as reconstruction input.

Every cell has exactly the same integer dimensions. For width W, height H, columns C, rows R, symmetric margin M and gutter G:

`cellWidth = (W - 2*M - (C-1)*G) / C`

`cellHeight = (H - 2*M - (R-1)*G) / R`

The symmetric requested margin is retained. The closest nonnegative gutter giving integer dimensions is applied, preferring the larger value on a tie. Both formats share the divisibility conditions, so linked settings have identical applied gutters. Adjustment is at most four pixels in the supported range. Requested 10 px at margin 0 becomes **12 px**: mobile cells **534 × 632**, desktop cells **632 × 534**. Zero margin/zero gutter gives **540 × 640** and **640 × 540**. The UI and manifest disclose the applied value.

FIT uses a uniform scale, centers the whole scene, and fills unused cell space with the chosen padding colour. FILL uses a uniform covering scale and crops excess artwork according to each tile's saved position. Output is opaque sRGB 8-bit PNG; transparent source artwork is composited over the padding colour. Source tile PNGs and their native bit depth remain unchanged. Fractional scaling resolves to integer raster dimensions with normal one-pixel rounding; the manifest records both ideal uniform scale and actual resized dimensions.

The browser displays the actual exported PNG, so preview geometry is identical to downloads. Crop position changes require regeneration to refresh those previews.

## Files and persistence

Each generation is isolated to preserve previous exports:

```text
data/exports/<project-id>/
  runs/<extraction-id>/tiles/tile_01.png … tile_06.png    # Existing Module 2
  grid-settings.json
  layout-jobs/<generation-id>.json
  active-layout.json
  latest-layout.json
  layout-runs/<generation-id>/
    layouts/mobile_six_tile_grid.png
    layouts/desktop_six_tile_grid.png
    metadata/layout_manifest.json
```

The manifest includes source comic ID/checksum, extraction ID/configuration hash, source arrangement, settings, requested/effective geometry, output resolution/layout, reading order, six destination rectangles, source tile filenames/checksums, scale/resize/padding/crop/position details, artwork removal percentages, renderer version/kernel, output checksums and generation time. Rectangles use **output-image pixels** for future camera world coordinates. Identical saved settings and source PNGs deterministically regenerate identical PNGs with the same installed Sharp version. Manifest timestamps and generation IDs change on regeneration.

Source checksums and PNG dimensions are checked before rendering. Changing saved panel coordinates or re-extracting invalidates current grids until regeneration. Incomplete/cancelled generations never expose download endpoints; their job records and partial directories remain available for diagnosis.

## Verification status

Development and sample generation were prioritized at the user's request. **No test suites or diagnostic test benches were run during this Module 3 change.**

| Action | Actual outcome |
| --- | --- |
| TypeScript check and production build | PASS |
| Generate saved sample's mobile and desktop PNGs | Completed; both files visually inspected |
| Open saved sample in browser and capture Step 3 | Completed; previews loaded with no browser JavaScript errors |
| Fifteen Module 3 acceptance scenarios | NOT RUN |
| Additional Module 3 geometry/settings tests | NOT RUN |
| Module 1–2 regression suites after Module 3 | NOT RUN |
| Browser automated suites after Module 3 | NOT RUN |

The UI test bench starts at NOT RUN and displays actual PASS/FAIL only after **Run Module 3 checks** is explicitly clicked. Its 15th scenario runs the existing Module 1 and Module 2 API acceptance checks in a temporary workspace. No diagnostic runs automatically.

The captured interface preview is [previews/module-three-interface.png](previews/module-three-interface.png). The sample generation is stored under `data/exports/03080222-5f86-4423-a624-07ae2ec0698f/layout-runs/8987adfb-a606-4c57-96e7-bb5f120f61aa/`.

Optional test commands, when requested:

```powershell
npm run test:module3
npm run test:module1
npm run test:module2
npm run test:ui
```

`npm test` includes all three service suites. `npm run check` adds the build and browser suites. The copied sample remains `tests/fixtures/sample-comic.png`; the landscape fixture is `tests/fixtures/landscape-comic.jpg`.

## Changed files

Created: `shared/layout.ts`, `server/layout.ts`, `server/layout-jobs.ts`, `server/layout-checks.ts`, `src/components/GridStep.tsx`, `scripts/generate-grids.ts`, `tests/module-three.test.ts`, `MODULE_3.md`.

Preview artifact: `previews/module-three-interface.png`.

Modified: `server/app.ts`, `server/index.ts`, `scripts/dev.ts`, `src/App.tsx`, `src/components/ExtractionStep.tsx`, `src/styles.css`, `package.json`, `README.md`.

## Scope and remaining limitations

Module 3 development is implemented; automated acceptance remains unverified because suites were intentionally not run. Camera/focus controls, animation, videos, Gemini assets and Module 4 are not implemented. The Continue to Module 4 button is visibly disabled. Grid PNGs are raster outputs and resample artwork at their assigned cell size; six native-resolution source PNGs remain available in Module 2. Settings are local to this workspace and are included in the layout manifest download.
