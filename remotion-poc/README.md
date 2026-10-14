# Remotion proof of concept

An isolated package: nothing in the main app imports it. It turns a six-panel photo, a transcript and narration into a
finished lesson video with Remotion (React + Chrome + FFmpeg), in 9:16 or 16:9 from one composition.

## What it makes
- Typed title card, then one scene per panel: the camera zooms from the full grid into the panel, the character loop
  plays once it settles, then the camera **pulls back to the full set of tiles** before the next panel.
- Below the card: word-lit captions, key-phrase chips and a voice-reactive SVG wave.
- Automatic crop of each panel, automatic layout detection (2×3 or 3×2), narration timing from the audio files.

## Run it
From the project root, with FFmpeg available:

```bash
# 1. Narration, four voices taking turns (needs OPENAI_API_KEY in .env and API credits)
npx tsx scripts/generate-voiceover.ts --out voiceover

# 2. Detect panels, crop, make loops and loudness data
npx tsx remotion-poc/prepare-image.ts --image photo.jpg --audio voiceover --out remotion-poc/public-mobile --format mobile

# 3. Render
cd remotion-poc && npm install
npx remotion render src/index.ts Lesson out/lesson_mobile.mp4 --public-dir=public-mobile
```

Pass `--loops <folder>` to step 2 to use real character clips named `tile_01.mp4` … `tile_06.mp4`
(for example from Gemini). Without it a clearly labelled placeholder "breathing" loop is generated.
`npm run studio` opens Remotion Studio for a live preview.

## Limits
- The placeholder loops are a seamless zoom and sway of the still, not character acting.
- Caption highlighting is estimated from word length and punctuation, not aligned to the audio.
- Generated folders (`out/`, `public/`, `public-mobile/`) are git-ignored.
- Licence: Remotion is free for individuals and companies of up to three people; larger companies need a licence
  (remotion.pro). Check eligibility before commercial use.
