# Cinematic 3D Text Effects

## Use in the existing app

Start `npm run dev` and open http://localhost:5173. In Step 10, open **3D Text Effects**, then **Add 3D text**. Existing source-image, camera, verified Gemini-frame and media workflows are unchanged. Text is optional.

Edit the text, font, spacing, alignment, material, extrusion, bevel, position, rotations and layer order. Choose Particle assembly, Camera fly-through or Environmental 3D text. The default word is UNDERSTANDING with bevelled metallic gold. Font geometry preserves the entered characters; unsupported glyphs show an error rather than a substituted character. Bundled fonts are Helvetiker Bold, Optimer Bold and Gentilis Bold; notices ship under `public/licenses`.

**Animation duration** is the appearance duration. **Completed text visibility** is the additional completed hold. Start 12s + animation 1s + completed visibility 4s means animation frames 360–389, completed hold frames 390–509, and disappearance at 17s. Optional fade-out follows that hold. Seconds round upward to the next frame; the UI and manifests report integer frame indices. One second contains exactly frames 0–29.

Objects have independent timestamps and output selection (mobile, desktop or both). X/Y positions are normalized from −1 to +1; positive Y moves upward. Z, font geometry and camera keyframes use world units. Rotations use degrees. Long words fit each output aspect ratio before applying the user scale; deliberate position/scale changes may crop artwork. Layer order is ascending, with stable ID ordering for ties.

Save settings, then **Prepare footage preview**. This uses the existing assembly pipeline to make a base MP4 containing the camera paths, supplied Gemini footage, handoff bridges and synchronized narration. The editable transparent canvas previews text above that MP4 without changing source clips. Play, pause, restart and scrub use the same complete-lesson clock. Native video controls remain accessible. Checkerboard is a CSS preview surface and never reaches the renderer or export. Until footage is prepared, the reconstructed grid/checkerboard previews typography only and does not imply synchronized audio.

Changing footage, camera sources, output format or segment timing invalidates the cached base preview. Text-only edits remain live over a prepared base. A selected-tile render rebases the complete lesson clock to that tile's first camera frame. If the complete timeline cannot be calculated because other tiles lack inputs, selected-tile renders explicitly omit text with a warning. Full/complete preview rendering includes every intersecting text object.

## Local rendering and outputs

Requires Node 20.19+, FFmpeg/FFprobe and an installed local Chrome or Edge with WebGL 2. `TEXT_CHROME_PATH` can select another local Chromium executable. If neither system browser exists, install Playwright Chromium locally with `npx playwright install chromium`. No browser binary is downloaded during rendering and no cloud service is used.

`three` 0.180.0, its addons and definitions implement real extruded glyph geometry. React Three Fiber was unnecessary for the existing React architecture. A plain Three.js renderer is lazily loaded when the editor opens. Fonts are bundled once in the renderer, not copied into project JSON. An ephemeral HTTP server binds only to loopback for headless rendering; it serves only the bundled renderer and verified local HDR assets. Browser requests outside that server are blocked.

`shared/text-effects.ts` defines versioned objects, validation, seeded randomness, frame ranges, easing and camera interpolation. `shared/text-engine.ts` supplies shared preview/export geometry and materials, surface-sampled particles, actual perspective-camera movement, studio/HDR reflections, animated lights, optional fog and soft shadows, and alpha-preserving bloom. Export evaluates explicit frame indices; wall-clock timing and requestAnimationFrame are never used for exported animation state.

**Export transparent animation PNGs** exports the selected object's appearance only. A one-second animation produces `text_000000.png` through `text_000029.png` at the selected full output resolution. The ZIP includes a validation manifest mapping local filenames to complete-lesson frame indices, file SHA-256 values, dimensions and repeat-render verification. Completed holds/exit frames are included in final lessons, not this animation-only archive. Preview quality does not lower export quality.

For final lessons, PNGs stream directly into FFmpeg as a lossless QTRLE/ARGB MOV track across the text's active interval. Blank gaps reuse a transparent frame. The alpha track is composited over the existing assembled footage at its integer start frame. Existing AAC packets are copied through this compositing pass. Final MP4s remain H.264, yuv420p, constant 30 fps at 1080×1920 or 1920×1080 with the existing 48 kHz stereo AAC narration. Existing final stream, full-frame decode and narration-coverage checks still run before publication. H.264 is lossy; the additional compositing encode is not claimed pixel-identical to the base video.

Storage:

```text
data/exports/<project>/assembly/assembly_config.json       optional textEffects {version:1, objects:[]}
data/exports/<project>/assembly/text-environments/         retained local HDR + checksum metadata
data/exports/<project>/assembly/text-runs/<run>/           verified PNG ZIP, sequence manifest, job, receipt
data/exports/<project>/assembly/runs/<run>/text_layers/    lossless composited text layers
```

Temporary PNGs are removed after packaging, failure or cancellation. Interrupted jobs are marked failed on reopening and can be retried; prior successful archives/videos remain available. The queue prevents concurrent camera/assembly/text export jobs from overrunning the existing processing budget. Geometry leases, a bounded cache, particle limits, reduced preview resolution, stale-HDR disposal and WebGL cleanup bound resource use. Up to 16 text objects, 12,000 particles each and 48,000 combined particle budget are supported.

The editing ZIP includes final MP4s, text-layer MOVs with start offsets, text settings and referenced HDR assets alongside original camera, Gemini and voice assets. Import the finished MP4 into Clipchamp; text is already composited. Independent alpha-MOV import in Clipchamp is not assumed. Use the existing EDL to repeat/trim imported Gemini clips to complete narration, return through the corresponding zoom-out, then proceed to the next grid zoom.

## Persistence and extension

Text extends the existing assembly-settings JSON, with its own `textEffects.version = 1`. Old assembly records without that field are read unchanged, and their existing output fingerprints remain compatible. Saving, reopening and project duplication preserve text configuration and verified HDR references. Original panel-project JSON remains the panel-coordinate document; the assembly JSON/editing ZIP contains composition settings.

The `textPresets` registry declares each preset's label, render kind, reveal range and camera-reveal behavior. The engine dispatches by render kind, so further lighting, camera and particle presets can reuse its deterministic path. Add a registry definition, extend schema parameters only with defaults/backward compatibility, implement any new geometry/shader behavior in the shared engine, and add unit, alpha, repeat-render and compositor tests before exposing it in the selector. Planned extensions are metallic light sweep, fragment reconstruction, light-trail construction, volumetric emergence, glass refraction, depth burst, letter-by-letter reveal and disintegration. These eight secondary effects are not implemented or advertised as available controls.

Transparent glass currently uses physical specular reflections and reduced alpha, without refracting the base video. Depth of field and actual volumetric scattering are omitted. HDR reflections accept Radiance `.hdr` files (maximum 16 MB and 4096×4096); EXR and custom font uploads are not supported. Repeatability is verified on the same local rendering implementation; byte equality across different GPU drivers/browser versions is not promised. Source Gemini images remain derived from their camera MP4s; adding text to the final lesson does not change authoritative frame handoffs.

## Tests and manual acceptance

```powershell
npm run build
npm run test:unit
npm run test:text
npm test
npm run test:ui -- tests/browser/text-effects.spec.ts tests/browser/assembly.spec.ts tests/browser/smoke.spec.ts
```

Automated media tests use clearly named synthetic footage/narration stand-ins and the supplied six-panel fixture, not externally generated Gemini loops or voice-over. Actual outcomes are recorded in `TEXT_EFFECTS_TEST_REPORT.md`.

Manual acceptance:

1. Open an existing project, verify Step 10 imports and playback, then add UNDERSTANDING. Inspect spelling, depth, bevel, gold highlights, each font and both aspect ratios.
2. Scrub particle frames 0–7, 8–19, 20–26 and 27–29. Inspect convergence, solid reveal and the settled word. Restart twice and confirm the same particle arrangement.
3. Select fly-through and scrub its camera path. Edit keyframes/FOV/target, verify perspective and the readable end. Test rotations and independent positions.
4. Select environmental text. Inspect moving highlights, studio/HDR reflection, bloom, soft shadow and fog over footage. Confirm checkerboard is preview-only.
5. Place one-second text at 12s, hold four seconds, and add another object/layer. Verify onset at frame 360, settled frame 389, and hold through frame 509. Save/reload/duplicate.
6. Prepare footage preview. Verify Gemini motion, camera transitions, handoff bridges and narration; use native controls and the scrubber. Toggle low preview quality.
7. Export transparent PNGs, inspect alpha over light/dark backgrounds, and check 30 filenames plus manifest. Cancel/retry an export and confirm older downloads still work.
8. Render both final formats. Inspect all text intervals, alpha edges, voice timing, original transition continuity and the finishing grid; import finished MP4s into Clipchamp.
9. Remove every text object and render again; confirm the original assembly behavior. Test missing WebGL, a missing HDR file, an unsupported glyph and a corrupt external clip for clear errors.

Reference APIs: [TextGeometry](https://threejs.org/docs/pages/TextGeometry.html), [WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html), [MeshPhysicalMaterial](https://threejs.org/docs/pages/MeshPhysicalMaterial.html), [HDRLoader](https://threejs.org/docs/pages/HDRLoader.html), [Playwright local browser launch](https://playwright.dev/docs/api/class-browsertype).
