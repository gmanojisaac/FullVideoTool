# Actual verification report

Updated 10 October 2026. This report distinguishes executed checks from pending work.

| Coverage | Actual outcome | Evidence |
|---|---|---|
| Modules 1–6 service/geometry tests | PASS: 116 tests; zero failures/skips | previews/module-one-through-six-tests.log |
| Module 5 browser target (earlier build) | PASS: 6 tests | previews/module-five-browser-tests.log |
| Module 6 standalone | PASS: 21 tests | previews/module-six-tests.log |
| Module 7 standalone, including earlier API regressions | PASS: 21 tests / 20 acceptance cases; zero failures/skips | previews/module-seven-tests.log; module-seven-report.json |
| Available Module 9 integration | PASS: 10 tests; zero failures/skips | previews/module-nine-integration-tests.log |
| Build after integration components and queue | PASS | TypeScript noEmit and Vite build executed |
| Complete available regression run after integration changes | PASS: 147 tests, zero failures/skips, 609.5 seconds | previews/module-one-through-nine-available-tests.log |
| Full browser suite after integration, initial run | 27 PASS / 6 FAIL | previews/module-one-through-nine-browser-first-run.log |
| Full browser suite, corrected rerun | 32 PASS / 1 FAIL | previews/module-one-through-nine-browser-tests.log; remaining cancellation-start race corrected |
| Cancellation target | Cancel and preservation passed; responsive overflow failed | previews/module-six-cancel-browser-test.log; 677px overflow corrected, independently inspected at 390px; full rerun pending |
| Module 8 | SKIPPED / missing implementation | User says remaining prompt specification will follow |
| Complete Module 9 workflow with twelve editable prompts | SKIPPED | Depends on missing Module 8 |
| Module 10 targeted actual media acceptance | 24 PASS / 0 FAIL; earlier regression case SKIPPED | previews/module-ten-target-tests.log; 248 seconds |
| Module 10 revised actual media acceptance | 24 PASS / 0 FAIL | previews/module-ten-final-tests.log; fallback/silent MP4s actually rendered; regression launcher issue described below |
| Current complete available earlier regressions | PASS: 154 tests, zero failures/skips, 556.4 seconds | previews/module-ten-regressions.log |
| Module 10 consolidated acceptance report | PASS: 25/25 checks | previews/module-ten-report.json; 24 media cases plus actually executed earlier regression case |
| Current ZIP/timing/startup/recovery/storage units | PASS: 11 tests, zero failures/skips | previews/module-ten-unit-tests.log |
| Module 10 assembly + startup browser checks | PASS: 5 tests | previews/module-ten-assembly-browser-tests.log |
| Earlier browser verification after Module 10 | 32 PASS / 1 FAIL initially; affected cancellation test PASS after correction | previews/module-ten-earlier-browser-tests.log; module-ten-frame-cancel-browser-test.log |
| Corrected cancellation, retained PNGs and responsive controls | PASS: 1 test, 51.9 seconds including camera/frame setup | previews/module-ten-frame-cancel-browser-test.log |
| Current browser coverage across suite and targeted rerun | PASS: all 38 distinct checks (33 earlier + 5 assembly/startup) | The initial failure and corrected rerun remain separate logs |
| Supplied-comic complete lesson demo | PASS: both formats, 36.6 seconds / 1,098 frames each; actual full video/audio decodes | previews/module-ten-sample-manifest.json; final_video_validation.json in its run directory |
| Supplied-comic actual browser video playback | PASS: both native dimensions, seeking to 6 seconds, no runtime errors, 390px viewport | previews/module-ten-sample-browser.json; module-ten-sample-output.png |
| Current production build | PASS: TypeScript and Vite | previews/module-ten-build.log |
| Consolidated application evidence | Module 10 PASS; full application PARTIAL because Module 8 remains pending | previews/application-validation.json |

Portrait sample: project 03080222-5f86-4423-a624-07ae2ec0698f. All 24 transitions and two previews were generated at full resolution and checked. Its twelve PNGs exactly match independent decoded zoom-in RGB frames, with zero differing pixels. Twelve saved zoom-out geometry checks pass. Separately encoded zoom-out frames have RGB differences in all twelve cases; this is reported explicitly and does not invalidate the authoritative PNGs. No external Gemini videos have been inspected or called seamless.

The actual landscape fixture passed upload/detection, extraction, independent mobile 2×3 and desktop 3×2 reconstruction, twelve focus configurations, 26 compact-duration full-resolution camera videos, twelve exact first frames, and a 57-entry verified ZIP. Service recreation restored coordinates, framing, timing, stage and completed package hashes. Duplication/deletion confirmation, a one-format camera render and downstream invalidation passed.

The first Module 9 integration run was interrupted after its eight subcases because the test left a large HTTP download body unread, preventing server shutdown. The test now consumes the body, and the rerun completed with ten passes. Initial Module 5/6 failures and their corrected reruns are retained in earlier logs; startup handshake and publication order were fixed before the 116-pass baseline. They are not hidden as passes.

Reliability exercised by existing suites: corrupt/unsupported images, missing video tools, corrupt/missing MP4s, modified PNG pixel detection, EXIF/transparent/16-bit tile integrity, stale coordinates, cancellation/retry, persistence, unsafe IDs, ZIP traversal/duplicates, optional missing bridges and 64 MB streaming payloads (64 KB maximum input chunk). Actual low disk-space exhaustion has not been performed; it remains SKIPPED. No live user data was deleted in tests.

The supplied comic's 57-file Module 7 archive was created successfully and reopened independently using .NET ZipArchive: all payload SHA-256 values, manifest hash and archive hash passed. Evidence: previews/module-seven-independent-zip-check.log and module-seven-sample-receipt.json. Initial failures were corrected: metadata comparison now ignores JSON key order, and ZIP verification uses central-directory offsets rather than interpreting header-like bytes inside MP4 payloads.

Module 10 tests actually imported all twelve synthetic video fixtures and six synthetic narration fixtures (MP3/WAV/M4A/AAC), reviewed forward/crossfade/ping-pong repeats, rendered both full-resolution final lessons and reopened a 64-entry editing archive. Eight-point-four-second MP3 narration decoded to exactly 403,200 samples. PCM placement, silence over transitions, camera checksums, full-grid holds, final codecs/frame timestamps/AAC coverage, persistence and cancellation/retry passed. They establish technical assembly behavior; external Gemini motion and spoken narration have not been supplied or visually approved.

The first Module 10 setup failed because FFmpeg's sine generator rejected the fixture duration string `.25`; this was changed to `0.25`. The revised media run passed. Its nested regression launcher initially inherited NODE_TEST_CONTEXT and skipped files while returning zero. That apparent regression PASS was corrected to SKIPPED immediately; the launcher now clears the worker flag and requires a real TAP count with zero failures/skips. The corrected execution actually ran all 154 earlier/ZIP/timing tests and passed. No skipped run is claimed as a pass.

Module 8 and complete Module 9 acceptance remain pending the missing specification. Module 10 browser verification and the retained supplied-comic demo outputs are complete. No Module 11 work is included. Native Clipchamp import was not exercised; standard H.264/AAC MP4 characteristics and complete decodability were tested.

The first Module 10 browser run was interrupted after seven failures because a new refresh condition dereferenced null state on initial page load. The condition is corrected. A new empty-workspace smoke check passed without browser runtime errors; its first selector was narrowed to the upload area to distinguish the visible button from the file input's implicit button role. The complete browser rerun is recorded separately above.

The next browser run exposed an upload-lock cleanup bug after invalid-media rejection: Express had cleared route parameters before the close handler read the project ID. Cleanup now captures the ID and runs at response finish/close. A completion polling race also discarded refreshed output state after setting terminal status; the editor now installs the completed state after fetching its manifest. All five assembly/startup browser checks then passed, including rejected files, actual loop preview, selected-tile download, shared narration, restoration, narrow viewport, cancellation and retained output.

The final earlier-browser suite passed 32 checks and failed its cancellation check before the frame job started: Windows returned EPERM while atomically replacing active-frames.json. JSON writes now retry only transient lock errors within a bounded interval and preserve existing metadata. Temporary JSON files are removed after failed writes; a frame-pointer startup failure records a failed job before releasing its startup reservation. Two actual filesystem unit checks passed, including simulated transient lock recovery and permanent-error preservation. The affected browser test then passed, including cancellation, completed-frame preservation and the 390px layout. This targeted rerun completes all 38 distinct browser checks; it is not presented as one fresh all-pass suite execution.

Supplied-comic demo render: 8f0e47b7-13e5-4f45-a7ed-07d2ff895822. Mobile 1080×1920 and desktop 1920×1080 each have 1,098 decoded video frames, 36.6-second video and audio tracks, H.264/yuv420p/CFR 30 fps, AAC/48 kHz/stereo and PASS validation. Six explicitly labeled synthetic narration tones and twelve selected verified-still fallbacks were used. The 52-entry editing ZIP was reopened and hashed, with a 65,536-byte maximum input chunk. Archive SHA-256: 5844c737d47ea834da1bec9b82317a4b1e677a065d012619586e3dc1af40f844. No actual Gemini motion or spoken narration was supplied.

The consolidated evidence reader initially treated PowerShell's UTF-16LE logs as UTF-8 and could not parse their summaries. It now detects the byte-order mark and reads both UTF-16LE and UTF-8 logs. The regenerated evidence report passes every executed Module 10 check and explicitly retains the pending Module 8/9 entries as SKIPPED.
