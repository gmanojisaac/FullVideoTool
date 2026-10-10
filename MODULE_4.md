# Module 4 — Camera focus and framing

Open http://localhost:5173. A saved project can be opened directly with `/?project=<project-id>#camera-focus`. Run `npm run dev` to start the local React/Vite interface and Node/Sharp service. Existing Modules 1–3 remain in place.

## Manual use

1. Finish Steps 1–3: save six boundaries, extract native PNGs, and generate the current mobile/desktop grids. Click **Continue to Module 4**.
2. Select Mobile or Desktop, then one of the six thumbnails. Each tile has independent settings for both formats, with separate Native and Detail transforms inside each view.
3. **Native Camera** uses the actual reconstructed grid. The preview includes neighbouring panels and gutters wherever the chosen crop can see them. Native coordinates are clamped to the grid bounds; effective scale is at least 1.
4. **Reframed Detail** uses the original extracted tile. Its warning and saved `requiresControlledTransition` flag identify the need for a future controlled transition. Switching modes preserves both configurations.
5. Drag the preview to pan, use the zoom slider or wheel to zoom, and use Horizontal/Vertical position sliders for precision. Focus the preview and use arrow keys; Shift increases the step. `+` / `−` zoom.
6. Use **Centre**, **Fit entire scene**, **Fill output frame**, or **Reset to automatic**. Undo/Redo restore previous framing adjustments. Safe-area and rule-of-thirds guides are optional and are excluded from exported stills.
7. Edits autosave after a 650 ms pause. **Save current framing** explicitly approves the selected view. Other stages stay locked while changes are being saved, and preview generation locks framing until completion/cancellation.
8. **Auto Focus** preserves manual or approved framing. **Reset to automatic** explicitly replaces that selected view with default framing. Automatic suggestions are unverified centre fallbacks because no local face/eye/hand/object model is installed. No detected subject is invented.
9. **Generate Focus Previews** saves pending settings and renders all twelve provisional PNGs. Compare mobile and desktop at the bottom. Download the selected stills and `focus_config.json`. Changed framing hides stale stills until regenerated.
10. Reopen the saved project to restore all twelve configurations and matching previews. Interrupted rendering is retryable; completed files remain downloadable. Cancel stops after the current image operation.

These stills are **provisional framing previews**. They are not Gemini start frames. Future authoritative Gemini PNGs must be extracted from decoded finished MP4s.

## Automatic framing limitation

No subject detector is installed or downloaded in this module. Auto Focus uses an honest, immediately editable, unverified centre fallback. It does not claim to find faces, eyes, hands or objects. Safe-area guides do not guarantee subject preservation. Crops excluding more than 10% of the selected cell/artwork show a non-blocking content-loss warning; inspect the image yourself. Native FIT can show neighbours because viewport and cell aspect ratios differ.

## Deterministic geometry

`shared/focus.ts` is the geometry specification used by both React and the service. Settings store camera mode, normalized centre, FIT/FILL, relative zoom and padding colour. Saved Native centres refer to **grid pixels**; Detail centres refer to **original extracted tile pixels**. Each view records both transforms, source grid dimensions, selected cell rectangle, output dimensions, scale, translation, visible source rectangle, clipped source rectangle and content-loss disclosure.

For output width W and height H, source centre `(cx, cy)` and uniform scale s:

`translation = (W/2 - cx*s, H/2 - cy*s)`

`visibleSource = (cx - W/(2*s), cy - H/(2*s), W/s, H/s)`

The browser SVG uses this exact matrix and source dimensions. Responsive screen coordinates are converted with the inverse SVG screen matrix and immediately discarded; device-pixel ratio never enters saved coordinates. Browser interpolation can differ slightly from the backend sampler, while geometry remains identical. The exported backend stills displayed in the comparison are authoritative for this module's provisional output.

`shared/focus-render.ts` defines deterministic bilinear sampling at output pixel centres, with premultiplied alpha compositing over the saved padding colour. Sharp decodes source RGBA and encodes the final opaque sRGB 8-bit PNG. Both axes use one scale, with no rotation, stretching, substitution of artwork, or generative fill. Sampling version `bilinear-pixel-centres-v1` is included for a future renderer. No animation renderer is implemented here.

The service recomputes all transforms from settings; it ignores supplied client transform fields or detection claims. Twelve unique tile/format settings, finite positions, zoom 0.25–8, valid colours, current grid identity and expected revision are validated. Finite positions outside the source are safely clamped. Stale revisions receive HTTP 409.

## Output and persistence

```text
data/exports/<project-id>/
  metadata/focus_config.json
  focus-jobs/<generation-id>.json
  active-focus.json
  latest-focus.json
  focus-runs/<generation-id>/
    metadata/focus_config.json
    metadata/focus_preview_manifest.json
    previews/mobile_tile_01_focus_preview.png … mobile_tile_06_focus_preview.png
    previews/desktop_tile_01_focus_preview.png … desktop_tile_06_focus_preview.png
```

The project config has all twelve views, project/source/extraction/grid identifiers, separate Native/Detail settings and transforms, mode, focal point, zoom, crop/translation/padding, automatic suggestion status, manual/approval flags, revision and save timestamps. Preview runs have immutable config snapshots, exact filenames/dimensions/modes and PNG hashes. Files from extraction and grid generation remain unchanged. Changing/rebuilding the grid invalidates current framing; new grid geometry gets default views. Previous completed focus runs remain available.

Generate saved framing from the terminal:

```powershell
npm run focus-previews -- <saved-project-id>
```

## Actual verification

| Verification | Result |
| --- | --- |
| Before implementation: existing Module 1–3 service suite | PASS — 50 tests, 0 failures |
| Module 4 service acceptance + extra geometry/rendering tests | PASS — 22 tests, 0 failures (18 acceptance checks, 3 extra checks, parent group) |
| Full Module 1–4 service regression run | PASS — 72 tests, 0 failures |
| Module 4 browser scenarios | PASS — 6 scenarios |
| Existing Module 1–2 browser scenarios | PASS — 12 scenarios across initial run and affected retry |
| Direct saved-project link after final interface change | PASS — one focused browser scenario |
| TypeScript and production build | PASS |
| Sample generation | Complete — 12 provisional PNGs, correct mobile/desktop resolutions |

The first combined browser run had a Module 2 bench timeout and a localhost API connection timeout during Module 4 setup while the full service suite was running. After that service run finished, all six camera browser scenarios passed and the affected Module 2 bench passed. Tests were not silently reported as passing from the failed initial run. See the logs below.

The six camera browser scenarios cover direct project loading, twelve views, true grid source, honest fallback label, drag/wheel/keyboard, approval/manual priority, separate detail mode, undo/redo, independent format settings, tile switching, reload, twelve output dimensions, downloaded config, stale-preview invalidation, FIT/FILL/reset/centre, responsive layout, and toggled guides.

The service acceptance checks include an exact decoded-pixel assertion: Native scale 1 matches every RGBA pixel of the original approved grid in both formats, including neighbours and gutters. A fresh service instance restores the entire saved config. Earlier module regressions are also exercised inside the Module 4 diagnostic bench.

Re-run sequentially to avoid competing diagnostic/rendering workloads:

```powershell
npm run build
npm test
npm run test:ui
```

For only this module: `npm run test:module4` and `npx playwright test tests/browser/focus.spec.ts`. UI benches display real PASS/FAIL after clicking their Run checks button.

## Evidence and examples

- [Full service regression log](previews/module-four-all-service-tests.log)
- [Module 4 service log](previews/module-four-service-tests.log)
- [Initial browser log](previews/module-four-browser-tests.log)
- [Camera browser rerun](previews/module-four-focus-browser-retest.log)
- [Affected Module 2 bench retry](previews/module-four-module2-bench-retest.log)
- [Direct project-link check](previews/module-four-deeplink-test.log)
- [Mobile editor screenshot](previews/module-four-mobile-editor.png)
- [Desktop editor screenshot](previews/module-four-desktop-editor.png)
- [Generated sample output paths](previews/module-four-sample-generation.json)
- [Browser-exported twelve-view config](previews/module-four-focus-config.json)

The supplied sample's twelve Native Camera preview files are under `data/exports/03080222-5f86-4423-a624-07ae2ec0698f/focus-runs/16e5c264-a04b-486e-bc82-470f5b54246c/previews/`. The desktop editor screenshot also demonstrates a labelled Reframed Detail crop and its content-loss warning from a browser test project.

## Changed files

Created: `shared/focus.ts`, `shared/focus-render.ts`, `server/focus.ts`, `server/focus-checks.ts`, `src/components/FocusCanvas.tsx`, `src/components/FocusStep.tsx`, `scripts/generate-focus.ts`, `tests/module-four.test.ts`, `tests/browser/focus.spec.ts`, `MODULE_4.md`.

Modified: `server/app.ts`, `server/index.ts`, `scripts/dev.ts`, `src/App.tsx`, `src/components/GridStep.tsx`, `src/styles.css`, `package.json`, `README.md`.

Generated evidence: logs, screenshots, exported config, and sample-generation JSON under `previews/`; twelve provisional sample stills and job/config/manifest files under `data/exports/`.

Module 5 is disabled. No camera animation, MP4, final Gemini frames, loops, voice-over or Clipchamp work is included.
