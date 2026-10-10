# Using Six-Tile Lesson Video Builder

Start the application with `npm run dev` and open http://localhost:5173.

1. Choose **New project**, then upload a PNG, JPEG or WebP comic. Portrait and landscape sample buttons let you try the application without another file.
2. Check the six numbered panel guides. Select columns × rows if needed. Drag gutter edges, or select individual panel mode and adjust each rectangle. Enter exact pixel coordinates for precise corrections. Name the project, optionally enter a lesson title, and save.
3. Extract the six tiles. Downloads preserve native pixels and reading order.
4. Create both grids. FIT preserves the whole artwork with padding. FILL crops; inspect the disclosed lost area.
5. Inspect twelve camera views: six mobile and six desktop. Adjust pan, zoom and crop independently. Native Camera uses the grid; Reframed Detail adds an explicitly labelled controlled reframing handoff. Automatic suggestions are currently an unverified image-centre fallback, so inspect faces, hands and important objects yourself. Save settings or generate previews.
6. Configure camera timing. Preview one tile, render a selected tile or format, or render all. The local queue limits simultaneous FFmpeg work. Cancel or retry as needed; previous valid files stay available.
7. Extract all first-frame PNGs. These come from the actual last displayed frame of each finished zoom-in MP4. Each is reopened and compared against another complete video decode. All twelve mandatory RGB tests must pass. Separate zoom-out RGB differences are reported; inspect the handoff and optionally generate a bridge.
8. Gemini motion prompt editing is awaiting the remainder of the supplied Module 8 specification. Use the package's manual Gemini instructions in the meantime. Do not assume an externally generated clip returns to an identical ending pose.
9. Export mobile, desktop or a combined package. Fresh file validation runs, then a verified ZIP download appears. Open its two instruction files. In Clipchamp, create separate 9:16 and 16:9 projects, insert grid stills and individual transitions, manually generate/import Gemini clips, and repeat or trim them to your separately supplied narration.
10. In **Assemble Final Lesson**, import six Gemini videos separately for each format and six narration files shared between formats. Select a usable segment and review three repetitions. Inspect the first-frame and seam indicators, choose optional bridges/crossfades, and set grid holds and volume. Missing media needs an explicit still or silent fallback. Preview one tile or the complete timeline, render mobile/desktop/both, then download the finished videos, frame/sample timeline, validation report and editing ZIP.

Open saved projects from the list or their local links. The latest visited available stage is restored. Rename by changing the project name and saving. Duplication retains source pixels, boundaries, layout/timing settings and the camera recipe; generate the duplicate's own assets before export. Deletion requires typing its exact name; a recoverable copy remains in `data/trash`.

The asset dashboard identifies missing, ready, outdated and review-required outputs. Editing panel boundaries invalidates downstream assets. Editing layout geometry requires new framing review and rendering. Old files stay in their own generation directories.

Narration determines focused-motion duration and starts there by default. Camera timings stay unchanged. Visual time rounds up to whole 30 fps frames while every decoded 48 kHz narration sample is preserved. The sample demo uses labeled test tones and explicit still fallbacks; replace these with your real narration and external Gemini videos. No Gemini generation, voice generation or cloud service is automatic.
