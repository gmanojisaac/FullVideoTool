import React from 'react';
import { AbsoluteFill, Audio, Img, Loop, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { Background, Captions, Chip, Ring, Typewriter, Waveform, useSceneOpacity } from './parts';
import { LessonData, Tile, clamp, colors, font, fps, gridHoldFrames, introFrames, keyPhrases, leadFrames, outroFrames, pullFrames, smootherstep, tileFrames, totalFrames, wordTimings } from './theme';

const mmss = (frames: number) => { const s = Math.floor(frames / fps); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

/** Footer: brand, timecode and a thin progress bar driven by the absolute frame. */
const Hud: React.FC<{ offset: number; total: number; label: string }> = ({ offset, total, label }) => {
  const f = useCurrentFrame() + offset;
  return <>
    <div style={{ position: 'absolute', left: 72, bottom: 38, fontSize: 18, letterSpacing: 3, color: 'rgba(244,246,251,.5)', fontFamily: font }}>SIXFRAME · {label}</div>
    <div style={{ position: 'absolute', right: 72, bottom: 38, fontSize: 18, letterSpacing: 2, color: 'rgba(244,246,251,.5)', fontFamily: font, fontVariantNumeric: 'tabular-nums' }}>{mmss(f)} / {mmss(total)}</div>
    <div style={{ position: 'absolute', left: 0, bottom: 0, height: 4, width: `${clamp(f / total) * 100}%`, background: `linear-gradient(90deg, ${colors.accent}, ${colors.accent2})` }}/>
  </>;
};

const Intro: React.FC<{ title: string; moments: number; total: number }> = ({ title, moments, total }) => {
  const f = useCurrentFrame(), opacity = useSceneOpacity(introFrames, 4, 12), line = smootherstep((f - 52) / 26);
  return <AbsoluteFill style={{ opacity, alignItems: 'center', justifyContent: 'center', fontFamily: font }}>
    <div style={{ fontSize: 24, letterSpacing: 12, color: colors.accent, opacity: clamp((f - 4) / 12), marginBottom: 26 }}>A SIX-TILE LESSON</div>
    <Typewriter text={title} startFrame={12} />
    <div style={{ height: 5, width: 560 * line, borderRadius: 3, marginTop: 26, background: `linear-gradient(90deg, ${colors.accent}, ${colors.accent2})`, boxShadow: `0 0 30px ${colors.accent}88` }}/>
    <div style={{ display: 'flex', gap: 16, marginTop: 46 }}><Chip text={`${moments} moments`} delay={58}/><Chip text="Narrated" delay={66} hue={colors.accent2}/><Chip text="Word-synced captions" delay={74} hue={colors.warm}/></div>
    <Hud offset={0} total={total} label="LESSON"/>
  </AbsoluteFill>;
};

/** Artwork rectangle of tile `i` in grid coordinates (the automatic crop applied to its cell). */
const artRect = (data: LessonData, i: number) => {
  const cell = data.cells[i], tile = data.tiles[i], fit = Math.min(cell.width / tile.tileWidth, cell.height / tile.tileHeight);
  return {
    x: cell.x + (cell.width - tile.tileWidth * fit) / 2 + tile.art.x * fit, y: cell.y + (cell.height - tile.tileHeight * fit) / 2 + tile.art.y * fit,
    width: tile.art.width * fit, height: tile.art.height * fit,
  };
};

/** The character emotion loop: fades in over the settled still, loops for as long as the tile is in focus, fades out as the camera pulls back. */
const LoopLayer: React.FC<{ src: string; frames: number; length: number }> = ({ src, frames, length }) => {
  const f = useCurrentFrame(), opacity = clamp(f / 10) * (1 - clamp((f - (length - 8)) / 8));
  return <div style={{ position: 'absolute', inset: 0, opacity }}><Loop durationInFrames={frames}><OffthreadVideo src={src} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }}/></Loop></div>;
};

const TileScene: React.FC<{ data: LessonData; tile: Tile; index: number; offset: number; total: number }> = ({ data, tile, index, offset, total }) => {
  const f = useCurrentFrame(), { fps: rate, width: W, height: H } = useVideoConfig(), frames = tileFrames(tile);
  const mobile = H > W, first = index === 0, last = index === data.tiles.length - 1;
  // Two layouts from one composition: card left and text right (16:9), or card on top and text below (9:16).
  const AREA = mobile ? { x: 60, y: 250, w: 960, h: 900 } : { x: 72, y: 72, w: 1080, h: 912 };
  const audioFrames = Math.ceil(tile.seconds * rate), art = artRect(data, index);
  // One card size for every tile (from the average artwork shape), so the grid state is identical between scenes.
  const aspect = data.tiles.reduce((a, _t, i) => { const r = artRect(data, i); return a + r.width / r.height; }, 0) / data.tiles.length;
  const cardW = data.card ? data.card.width : Math.min(AREA.w, Math.round(AREA.h * aspect)), CARD = { x: AREA.x + (AREA.w - cardW) / 2, y: AREA.y, w: cardW, h: data.card ? data.card.height : AREA.h };
  // Camera over the grid. In: grid -> tile. Out (last pullFrames + gridHoldFrames): tile -> full grid, held briefly, so the
  // next scene starts exactly where this one ends.
  const outStart = frames - pullFrames - gridHoldFrames;
  const zoomIn = smootherstep((f - 6) / 42), panIn = smootherstep((f - 6) / 34);
  const zoomOut = smootherstep((f - outStart) / pullFrames), panOut = smootherstep((f - outStart) / (pullFrames - 4));
  const zoom = zoomIn * (1 - zoomOut), pan = panIn * (1 - panOut);
  const drift = clamp((f - 48) / Math.max(1, outStart - 48)) * (1 - zoomOut);
  const s0 = Math.min(CARD.w / data.gridWidth, CARD.h / data.gridHeight), s1 = Math.max(CARD.w / art.width, CARD.h / art.height);
  const scale = Math.exp(Math.log(s0) + (Math.log(s1) - Math.log(s0)) * zoom) * (1 + 0.025 * drift);
  const cx = data.gridWidth / 2 + (art.x + art.width / 2 - data.gridWidth / 2) * pan, cy = data.gridHeight / 2 + (art.y + art.height / 2 - data.gridHeight / 2) * pan;
  const tx = CARD.w / 2 - cx * scale, ty = CARD.h / 2 - cy * scale;
  const enter = first ? spring({ frame: f, fps: rate, config: { damping: 18, stiffness: 90 } }) : 1;
  const yaw = 7 * (1 - zoom) + 0.9 * Math.sin((f + offset) / 70);
  const dim = Math.sin(Math.PI * clamp(zoom)); // other tiles dim only while the camera is travelling
  // The card stays on screen between tiles; only the first scene fades it in and the last fades it out.
  const cardOpacity = (first ? clamp(f / 10) : 1) * (last ? 1 - clamp((f - (frames - 12)) / 12) : 1);
  // Text and ring fade in at the start of the scene and out as the camera pulls back.
  const textOpacity = clamp(f / 10) * (1 - clamp((f - outStart) / 14));
  const loopFrom = 48, loopLength = Math.max(1, outStart + 8 - loopFrom);
  const words = wordTimings(tile.text, tile.seconds), phrases = keyPhrases(tile.text);
  const spoken = clamp((f - leadFrames) / audioFrames), chipStart = leadFrames + Math.round(audioFrames * 0.32);
  const chips = phrases.map((p, i) => <Chip key={p} text={p} delay={chipStart + i * 8} hue={[colors.accent, colors.accent2, colors.warm][i % 3]}/>);
  const textX = mobile ? 60 : AREA.x + AREA.w + 64, textW = mobile ? 960 : W - 72 - textX, ringY = mobile ? 96 : 84, captionY = mobile ? AREA.y + AREA.h + 56 : 268, chipY = mobile ? 1660 : 800, captionSize = mobile ? 50 : textW > 600 ? 42 : 38;
  return <AbsoluteFill style={{ fontFamily: font }}>
    <div style={{ position: 'absolute', left: CARD.x, top: CARD.y, width: CARD.w, height: CARD.h, perspective: 2000, opacity: cardOpacity, transform: `translateX(${(1 - enter) * -60}px)` }}>
      <div style={{ width: '100%', height: '100%', borderRadius: 28, overflow: 'hidden', position: 'relative', background: '#0b0f1c', border: `1px solid ${colors.glassLine}`, boxShadow: '0 40px 120px rgba(0,0,0,.6)', transform: `rotateY(${yaw}deg)`, transformOrigin: '50% 50%' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, width: data.gridWidth, height: data.gridHeight, transform: `translate(${tx}px, ${ty}px) scale(${scale})`, transformOrigin: '0 0' }}>
          <Img src={staticFile(data.grid)} style={{ width: data.gridWidth, height: data.gridHeight, display: 'block' }}/>
          {data.cells.map((c, i) => i === index ? null : <div key={i} style={{ position: 'absolute', left: c.x, top: c.y, width: c.width, height: c.height, background: 'rgba(6,9,19,.7)', opacity: dim * 0.9 }}/>)}
        </div>
        {tile.loop ? <Sequence from={loopFrom} durationInFrames={loopLength} layout="none"><LoopLayer src={staticFile(tile.loop.src)} frames={tile.loop.frames} length={loopLength}/></Sequence> : null}
        <div style={{ position: 'absolute', inset: 0, boxShadow: 'inset 0 0 120px rgba(0,0,0,.45)', pointerEvents: 'none' }}/>
      </div>
    </div>
    <div style={{ position: 'absolute', left: textX, top: ringY, width: textW, display: 'flex', alignItems: 'center', gap: 26, opacity: textOpacity }}>
      <Ring progress={(index + spoken) / data.tiles.length} label={String(index + 1).padStart(2, '0')} sub={`OF ${String(data.tiles.length).padStart(2, '0')}`}/>
      <div><div style={{ fontSize: 20, letterSpacing: 7, color: colors.accent }}>MOMENT {String(index + 1).padStart(2, '0')}</div><div style={{ fontSize: 22, color: 'rgba(244,246,251,.55)', marginTop: 8 }}>{data.title}</div></div>
    </div>
    <div style={{ position: 'absolute', left: textX, top: captionY, width: textW, opacity: textOpacity, transform: `translateY(${(1 - textOpacity) * 14}px)` }}>
      <Captions words={words} startFrame={leadFrames} size={captionSize}/>
      {mobile ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 44 }}>{chips}</div> : null}
    </div>
    {mobile ? null : <div style={{ position: 'absolute', left: textX, top: chipY, width: textW, display: 'flex', flexWrap: 'wrap', gap: 14, opacity: textOpacity }}>{chips}</div>}
    {tile.levels ? <div style={{ position: 'absolute', left: textX, top: mobile ? 1690 : 912, opacity: textOpacity }}><Waveform levels={tile.levels} startFrame={leadFrames} width={textW} height={mobile ? 120 : 70}/></div> : null}
    <Sequence from={leadFrames}><Audio src={staticFile(tile.audio)}/></Sequence>
    <Hud offset={offset} total={total} label={`MOMENT ${index + 1}`}/>
  </AbsoluteFill>;
};

const Outro: React.FC<{ data: LessonData; total: number; offset: number }> = ({ data, total, offset }) => {
  const f = useCurrentFrame(), opacity = useSceneOpacity(outroFrames, 10, 14), fill = smootherstep(f / 50), seconds = Math.round(data.tiles.reduce((a, t) => a + t.seconds, 0));
  return <AbsoluteFill style={{ opacity, alignItems: 'center', justifyContent: 'center', fontFamily: font }}>
    <Ring progress={fill} label={`${Math.round(fill * data.tiles.length)}/${data.tiles.length}`} sub="MOMENTS" size={220}/>
    <div style={{ fontSize: 76, fontWeight: 700, color: colors.ink, marginTop: 40, letterSpacing: -1.5 }}>{data.title}</div>
    <div style={{ fontSize: 28, color: 'rgba(244,246,251,.6)', marginTop: 14, letterSpacing: 1 }}>{data.tiles.length} moments · {seconds} s of narration</div>
    <Hud offset={offset} total={total} label="END"/>
  </AbsoluteFill>;
};

export const Lesson: React.FC<{ data: LessonData }> = ({ data }) => {
  const total = totalFrames(data); let at = introFrames;
  return <AbsoluteFill>
    <Background/>
    <Sequence durationInFrames={introFrames}><Intro title={data.title} moments={data.tiles.length} total={total}/></Sequence>
    {data.tiles.map((tile, i) => { const from = at, d = tileFrames(tile); at += d; return <Sequence key={tile.number} from={from} durationInFrames={d}><TileScene data={data} tile={tile} index={i} offset={from} total={total}/></Sequence>; })}
    <Sequence from={at} durationInFrames={outroFrames}><Outro data={data} total={total} offset={at}/></Sequence>
  </AbsoluteFill>;
};
