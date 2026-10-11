# Cinematic 3D text integration

## Inspection (Milestone 1)

- Entry: `src/main.tsx`, `src/App.tsx`; React state and stage navigation, no router or external state store.
- Upload/detection: `server/app.ts`, `server/detection.ts`, `src/components/PanelEditor.tsx`.
- Extraction/grids/focus: `server/extraction.ts`, `server/layout.ts`, `server/focus.ts` and their existing stage components.
- Camera clips: `server/animation-render.ts`, `shared/animation.ts`, `src/components/AnimationStep.tsx`.
- Gemini imports and narration: `server/assembly-media.ts`, `src/components/AssemblyStep.tsx` (implemented). Step 8 prompt generation is explicitly pending.
- Timeline: `shared/assembly.ts` calculates exact 30 fps frame and 48 kHz sample boundaries; Step 10 displays a read-only segment strip.
- Preview/export: Step 10 HTML video players; `server/assembly-render.ts` concatenates camera/loop segments and assembles narration; `server/assembly.ts` manages cancellable jobs and editing ZIPs.
- Persistence: atomic JSON via `server/storage.ts`; `assembly_config.json` is separate from the original panel-project JSON. `server/project-management.ts` copies assembly settings and media.
- Tests: `tests/assembly-timeline.test.ts`, `tests/assembly-jobs.test.ts`, `tests/module-ten.test.ts`, existing module/browser suites.

Add an optional versioned text track to assembly settings and timeline metadata. Add a lazy-loaded editor inside Step 10, with a transparent Three.js canvas over a synchronized composition preview. Reuse the same timestamp-driven engine in local headless Chromium for export, then composite the lossless alpha layer with FFmpeg before existing final-video validation. Preserve existing camera and media stages, source assets, and empty-track behavior.

New modules: `shared/text-effects.ts` (schema/timing), `shared/text-engine.ts` (geometry/animation), `src/components/TextEffectsPanel.tsx`, `src/components/TextCompositionPreview.tsx`, `server/text-render.ts`, `server/text-jobs.ts`. Existing integration points: assembly schema, editor, render service, API, editing ZIP and project duplication. No cloud renderer, paid service, or external generated animation.

## Delivered file changes

| Area | Files and responsibility |
|---|---|
| Shared engine | `shared/text-effects.ts`: versioned settings, validation, presets, seeded randomness and frame/camera evaluation. `shared/text-engine.ts`: real glyph geometry, materials, particles, lighting, alpha-safe bloom and resource cleanup. |
| Existing timeline | `shared/assembly.ts`: optional text track, applicable objects and selected-tile time offsets; compatible with earlier settings. |
| Editor | `src/components/AssemblyStep.tsx`: optional lazy editor and base-footage preview action. New `TextEffectsPanel.tsx`, `TextCanvas.tsx`, `TextCompositionPreview.tsx`, `TextExportControls.tsx`: independent objects, controls, synchronized playback and exports. `src/styles.css`: scoped responsive text-editor styles. |
| Local renderer | New `server/text-browser.ts`, `text-render.ts`: shared headless engine, verified RGBA sequences, lossless alpha video and FFmpeg composition. `text-jobs.ts`: persisted export jobs, progress, cancellation and interruption recovery. `text-assets.ts`: local HDR imports and checksums. |
| Existing services | `server/app.ts`: validated text/HDR endpoints and processing admission. `server/assembly-render.ts`: optional final text compositing before existing validation. `server/assembly.ts`: base preview, alpha-layer editing ZIP and recovery. `server/project-management.ts`: configuration/HDR duplication. |
| Packaging | `package.json`, `package-lock.json`: pinned Three.js, definitions and local renderer dependencies; test commands. `vite.config.ts`: addon pre-optimization. `public/licenses/`: bundled library/font notices. |
| Verification | New `tests/text-effects.test.ts`, `text-render.test.ts`, `text-composition.test.ts`, `tests/browser/text-effects.spec.ts`: timing, repeatability, alpha, full-resolution export, audio preservation, API composition and browser behavior. |
| Documentation | `README.md`, this report, `TEXT_EFFECTS.md`, `TEXT_EFFECTS_TEST_REPORT.md`: usage, architecture, actual outcomes, manual acceptance and limitations. |

The existing renderer is React/Node/FFmpeg; the integration uses it as requested. It does not migrate the project to a different backend. The planned eight secondary presets have extension hooks only; their implementations, depth of field and refraction of footage through glass are explicitly outside this delivery.
