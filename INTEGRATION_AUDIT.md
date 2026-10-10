# Integration audit — 9 October 2026

The existing React/TypeScript, Express, Sharp and FFmpeg application is retained. There is one frontend route (`src/App.tsx`), with stage components in `src/components`. Processing services are wired by `server/app.ts`; atomic JSON persistence is in `server/storage.ts`. Schemas and deterministic geometry are in `shared`. Image processing uses `server/detection.ts`, `extraction.ts`, `layout.ts` and `focus.ts`. Camera rendering uses `animation-render.ts`, its worker, `video-tools.ts`; authoritative video-frame decoding uses `frame-decode.ts`.

| Module | Initial status | Evidence |
|---|---|---|
| 1 Upload/detection | Implemented and tested | Existing service regression suite |
| 2 Extraction | Implemented and tested | Exact decoded tile equality including 16-bit PNG |
| 3 Reconstruction | Implemented and tested | Independent, equal-cell mobile/desktop grids |
| 4 Focus | Implemented and tested | Saved deterministic transforms; automatic semantic detection remains a disclosed center fallback |
| 5 Camera | Implemented and tested | 24 transitions and two previews rendered for the supplied comic; six browser cases previously passed |
| 6 Frame handoff | Implemented and tested (browser suite pending) | Twelve actual PNGs have zero RGB differences against independent decodes; geometry passes; separately encoded zoom-out pixels differ and are reported honestly |
| 7 Packaging | Missing at audit | To be implemented without altering renderer |
| 8 Prompts | Missing at audit; specification incomplete | Attachment ends at “Generate prompts”; user says more specification will follow |
| 9 Integration | Partially implemented | Existing save/open and upstream configuration hashes; project lifecycle, unified dashboard and final validation remain |

`previews/module-one-through-six-tests.log`: 116 tests passed, zero failed, zero skipped (302.6 seconds). This is the prerequisite regression run, not a claim that later modules passed. Module 6's standalone run: 21 passed. Full browser verification and both complete end-to-end workflows remain pending at audit.

No alternate processing stack or conflicting renderer was found. Existing module test benches deliberately repeat earlier API acceptance checks; test counts include this coverage. Completed run directories preserve prior outputs. The UI uses image pixels via explicit client-bounds conversion; source rectangles are integer EXIF-oriented pixels, tile coordinates start at the crop origin, grids use output pixels, normalized focal points use [0,1], viewport transforms use uniform scale and translation with pixel-centre sampling. Later stages consume saved transforms verbatim.

Critical integration work: lock upstream writes during packaging, verify current assets instead of relying on old reports, recover interrupted jobs, keep prompt edits independent of camera hashes, stream/verify archives, expose project lifecycle and current dependency status. A first-frame PNG passing validation does not establish the continuity of an externally generated Gemini video.
