# Cinematic text integration — actual test report

Executed locally on Windows on 2026-10-11. Results below are recorded only after actual execution. Automated media uses synthetic footage/narration stand-ins and the supplied six-panel fixture.

| Milestone | Actual validation | Outcome |
|---|---|---|
| 1. Integration inspection | Complete source/workflow inspection; report in TEXT_EFFECTS_INTEGRATION.md | Complete |
| 2. Geometry and transparent preview | Build; seven foundation tests; decoded WebGL PNG checks | Passed |
| 3. Editable timeline and persistence | Build; service recreation, legacy JSON, revision conflict checks; browser save/reopen/duplicate and narrow-screen checks | Passed |
| 4. Particle assembly | Seed/geometry tests, alpha/visible pixel checks, 30-frame full-resolution mobile export | Passed |
| 5. Camera fly-through | Camera interpolation and repeated-frame checks; full-resolution desktop 30-frame export | Passed |
| 6. Environmental text | Animated frame differences, transparent edges, studio lighting, actual local HDR reflections in final render | Passed |
| 7. Transparent export | Four media tests: all three full-resolution sequences, filenames/alpha/repeat rendering, cancellation cleanup | 4/4 passed |
| 8. Final compositor | Exact frame-360 onset, unchanged AAC packet hash; both full final formats through actual API, HDR import/duplicate, text PNG ZIP, layer-order configuration and editing ZIP contents | 2/2 passed |
| 9. Persistence/regression | Final unit run; full existing service regression and final browser acceptance | Unit 23/23; assembly acceptance 26/26; nested regressions 154/154; new text browser checks 4/4 passed |

Build and TypeScript checks succeed. The lazily loaded Three.js/font engine produces Vite's large-chunk advisory (about 1.37 MB uncompressed / 403 KB gzip); it is loaded only on demand. Initial WebGL checks exposed missing edge alpha and stale multisample clear frames; both issues were fixed and the checks rerun successfully. First dependency optimization triggered a Vite reload; explicit addon pre-optimization now prevents that first-editor-load interruption.

The first final browser check exposed a seek-rounding bug: Chromium reported a frame-1 timestamp as 0.033333 seconds, and flooring it sent the scrubber back to frame 0. Microsecond-tolerant media-frame conversion and pending-seek tracking correct this. Switching preview quality now creates a fresh canvas instead of reusing a deliberately lost WebGL context. The layer/bloom pixel test was changed to aggregate its comparison instead of making thousands of individual assertions; its focused rerun passed.

Evidence and rerun commands:

- `npm run build`: passed, including `tsc --noEmit`.
- `npm run test:unit`: final 23/23 passed, including 12 text/schema/timing/persistence/recovery checks; log at `previews/text-final-unit.log`.
- `npm run test:text`: 17/17 passed (11 foundation checks plus four full-resolution PNG/cancellation tests and two compositor/API tests); log at `previews/text-final-media.log`. The subsequently added media-timestamp check passed in the final unit run.
- `npm test`: 26/26 Module 10 acceptance checks and 154/154 available earlier nested module/service regressions passed, with no skips; logs at `previews/text-integration-regression.log` and `previews/module-ten-regressions.log`.
- Final full browser run: 41/42 passed, including all four new text checks and all assembly, camera, extraction, focus, frame-verification and export checks. The landscape editor test encountered a Vite proxy `connect ETIMEDOUT 127.0.0.1:3001`; its image response was HTTP 500, so the aspect-ratio assertion measured the failed image placeholder. Direct retry of the retained image endpoint returned HTTP 200. The unchanged test passed its focused rerun (1/1); no application or test change was needed. All 42 distinct browser cases therefore have passing evidence, without claiming the first full run passed. Logs at `previews/text-ready-browser.log` and `previews/text-landscape-rerun.log`; initial trace at `previews/text-ready-browser/editor-Upload-landscape-and-manually-switch-layouts/trace.zip`.
- Text browser checks verified native video/audio playback, frame-17 scrub position, low/high preview-quality switching without WebGL errors, independently editable layer order/bloom, PNG ZIP download, save/reopen, duplicate text and narrow-screen layout.
- Actual PNG samples/screenshots: `previews/text-effects/`, including `editor-composite.png` visually inspected with gold typography above real camera footage and accessible native video controls (local generated evidence, excluded from Git).

Manual acceptance is documented in TEXT_EFFECTS.md and is not claimed completed automatically. Secondary preset implementations, depth of field and footage refraction through glass remain out of the delivered core preset scope. Existing Module 8 prompt generation and incomplete Module 9 acceptance are unchanged. The dependency audit reports a pre-existing high advisory for the current Sharp/libvips dependency; that unrelated major-version upgrade is not included in this text integration.

The local development app was left running at http://localhost:5173 (API http://localhost:3001). Both health/frontend endpoints responded successfully after verification. Restart with `npm run dev` when required.
