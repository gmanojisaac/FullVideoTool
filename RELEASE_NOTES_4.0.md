# FullVideoTool 4.0.0

Released 14 October 2026.

The editor can now be hosted on Vercel and connect directly to the processing service on the viewer's PC. Video rendering, project files, image uploads and narration continue to use that computer. The hosted editor is available at https://full-video-tool.vercel.app.

## Changes

- Added a Vite deployment configuration and upload exclusions for local projects, generated media, environment files and Vercel credentials.
- Added `VITE_API_BASE_URL` support to API requests, samples, image previews, video/audio playback, HDR assets and downloads. Saved project JSON retains its relative media references.
- Added `ALLOWED_EDITOR_ORIGINS` for exact HTTPS editor origins, CORS preflights and local-network preflights. Unconfigured origins are rejected; the service continues to listen on loopback.
- Added a connection message and Reconnect button for the hosted editor.
- Added `start-processing.bat` to start the local processing service on Windows.
- Added origin-access tests to the unit-test command and updated package and lockfile versions to 4.0.0.

## Using the hosted editor

1. Install Node.js 20.19+ and run `npm ci` in this repository.
2. Install FFmpeg/FFprobe or configure their absolute paths as described in the README.
3. Create `.env` with `ALLOWED_EDITOR_ORIGINS=https://full-video-tool.vercel.app`. Keep any optional narration key in this local file.
4. Run `npm run server` or double-click `start-processing.bat`, then keep the service running.
5. Open https://full-video-tool.vercel.app on the same PC. Allow browser access to the computer/local network if prompted, then use Reconnect if needed.

For a separate Vercel deployment, set `VITE_API_BASE_URL=http://127.0.0.1:3001` for the frontend build and configure the exact deployed HTTPS origin in the PC's `.env`. Each viewer needs a local processing service on their own computer. This release does not move rendering or storage into the cloud.

## Verification

- The production frontend build passed.
- All 47 unit tests passed with FFmpeg/FFprobe configured; no tests were skipped.
- Two origin-access tests passed, covering allowed/rejected origins, preflight responses and exact HTTPS origin validation.
- Three selected browser regressions passed: workspace startup, portrait upload/layout and save/extract/preview/download/reopen.
- The published Vercel editor was tested in a temporary Chrome context against the local API: connection, upload, original image preview, portable project JSON, project saving, six-tile extraction and ZIP download passed without browser runtime errors.

These checks cover the hosting changes. Existing rendering and module limitations remain documented in the earlier test and release reports.
