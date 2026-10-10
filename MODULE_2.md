# Module 2 — Six-tile extraction and validation

The existing React/TypeScript and Node/Sharp implementation is retained, as explicitly requested for this module. Module 1 remains accessible. Reconstruction, focus, camera, video, Gemini, and Clipchamp work has not been started.

## Run and use

Start with `npm run dev`, then open **http://localhost:5173**. The local service runs on port 3001.

1. Upload a PNG/JPG/WEBP or load the supplied Portrait/Landscape fixture.
2. Adjust the six rectangles and click **Save project**. Saving confirms the current valid rectangles for extraction.
3. Open **Step 2 — Extract Six Tiles**. Click **Extract Six Tiles**.
4. Watch the processing indicator. **Cancel extraction** stops the job between operations and removes its incomplete output. **Retry extraction** uses the saved coordinates again after a failure.
5. Review six previews in reading order, their native dimensions, and the pixel verification results.
6. Download each `tile_01.png`–`tile_06.png`, the manifest, or **Download All Tiles ZIP**.
7. **Re-extract** creates a separate immutable run. **Back to Panel Adjustment** returns to Module 1. Any boundary edits hide obsolete previews and require saving before another extraction.
8. Reopen a saved project to restore its completed extraction or reconnect to a running job. An interrupted service job becomes a retryable failure.

## Pixel preservation

Module 1 already stores integer rectangles in EXIF-oriented original-image pixels. Module 2 uses those saved rectangles verbatim; it never redetects gutters or derives coordinates from browser dimensions. Fractional, empty, overlapping, out-of-bounds, or incorrectly ordered crops are rejected.

The service verifies the original file checksum, decodes it at full resolution, and copies the selected RGBA rows without resampling. PNG, JPEG, and WebP decode into a consistent sRGB RGBA representation. Alpha is retained. Sixteen-bit PNG samples remain sixteen-bit. PNGs use lossless encoding, without palette quantization, resizing, sharpening, brightness changes, or artwork regeneration.

Each actual written PNG is decoded again and compared byte for byte with its source region. A mismatch fails the entire job. The manifest records both decoded-region SHA-256 values, PNG SHA-256 values, dimensions, approved rectangles, layout, source filename/checksum, timestamps, bit depth, and PASS results.

The ZIP contains exactly six PNG files and `tile_extraction_manifest.json` at its root. A completed run is published only after all six files verify and ZIP creation finishes.

## Output and persistence

Original uploads remain unchanged in `data/inputs/`. Each extraction gets a separate directory:

```text
data/exports/<project-id>/runs/<extraction-id>/
  source/original_comic.png       # .jpg or .webp when appropriate; original bytes
  tiles/tile_01.png
  tiles/tile_02.png
  tiles/tile_03.png
  tiles/tile_04.png
  tiles/tile_05.png
  tiles/tile_06.png
  metadata/project.json
  metadata/tile_extraction_manifest.json
  six_extracted_tiles.zip
```

Job state and the latest successful run reference are persisted under the project export directory. Cropping configuration is saved in the manifest and the unchanged Module 1 project snapshot. Keep the `data` folder when moving the workspace.

## Verification actually performed

- Before edits: **PASS**, 13 Module 1 service/validation tests and 6 browser tests.
- After implementation: **PASS**, all 31 combined service/validation tests (13 Module 1, 18 Module 2).
- TypeScript check and production build: **PASS** during implementation.
- Combined browser run: **9 tests passed** before stopping at the user's request. The tenth test encountered a test-helper timing error during re-extraction: it read the new run before completion while the prior verified preview remained visible. The helper was corrected to await the specific job. **That correction and the remaining browser cases have not been rerun**, per the user's request to stop tests.

The 12 extraction acceptance scenarios passed in the executed service suite. They cover both orientations, exact file counts/dimensions/pixels/order, invalid/overlapping rectangles, deterministic PNG reproduction, Module 1 regression scenarios, PNG/JPG/WEBP, and complete ZIP content. Additional executed checks cover stale approval, alpha, EXIF, sixteen-bit samples, cancellation/retry, and service recreation.

The app includes a **Run Module 2 checks** button for visible PASS/FAIL results. It runs only when requested and uses an isolated temporary workspace. Commands are available as `npm test`, `npm run test:module1`, `npm run test:module2`, and `npm run test:ui`.

## Module 2 file changes

Created:

- `shared/extraction.ts`
- `server/extraction.ts`
- `server/extraction-jobs.ts`
- `server/extraction-checks.ts`
- `src/components/ExtractionStep.tsx`
- `tests/module-two.test.ts`
- `tests/browser/extraction.spec.ts`
- `MODULE_2.md`

Modified:

- `server/app.ts` — extraction, job, download, and diagnostic routes
- `server/index.ts`, `scripts/dev.ts` — startup labels
- `src/App.tsx` — Step 2 integration, confirmation and editing lock
- `src/styles.css` — responsive extraction UI
- `index.html` — application title and description
- `package.json`, `package-lock.json` — local ZIP dependency and test scripts
- `README.md` — Module 2 entry point

## Limitations

Only saved Module 1 pixel-coordinate projects are accepted; arbitrary third-party normalized coordinate schemas are not imported. Decoded pixel identity uses the documented sRGB RGBA representation, including color-profile conversion when required. Jobs finish the current Sharp operation before cancellation takes effect. Repeated successful runs are retained and consume disk space. Keep the original input storage for project reloads. The remaining browser validation is pending as described above.

References: [Sharp raw pixel output](https://sharp.pixelplumbing.com/api-output/#raw), [Sharp PNG output and bit depth](https://sharp.pixelplumbing.com/api-output/#png), and [Sharp auto-orientation](https://sharp.pixelplumbing.com/api-operation/#autoorient).
