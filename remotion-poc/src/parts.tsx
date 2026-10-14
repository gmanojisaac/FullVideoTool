import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { clamp, colors, font, smootherstep } from './theme';

/** Soft drifting glow blobs plus corner brackets: the "frame" of the video. */
export const Background: React.FC<{ hud?: React.ReactNode }> = ({ hud }) => {
  const f = useCurrentFrame(), { width: W, height: H } = useVideoConfig(), unit = Math.min(W, H) / 1080;
  // Blob positions are fractions of the frame so the same background works in 16:9 and 9:16.
  const blob = (x: number, y: number, size: number, color: string, speed: number, phase: number) => (
    <div style={{ position: 'absolute', left: x * W + Math.sin(f / 90 * speed + phase) * 70 * unit, top: y * H + Math.cos(f / 110 * speed + phase) * 50 * unit, width: size * unit, height: size * unit, borderRadius: '50%', background: color, filter: `blur(${120 * unit}px)`, opacity: .55 }}/>
  );
  const corner = (style: React.CSSProperties) => <div style={{ position: 'absolute', width: 34, height: 34, borderColor: 'rgba(255,255,255,.22)', borderStyle: 'solid', borderWidth: 0, ...style }}/>;
  return <AbsoluteFill style={{ background: `radial-gradient(1200px 700px at 50% 38%, #0d1424 0%, ${colors.bg} 70%)`, fontFamily: font, overflow: 'hidden' }}>
    {blob(-.08, -.11, 640, '#1a4a78', 1, 0)}{blob(.7, .52, 720, '#4b2a78', .8, 2)}{blob(.37, .72, 520, '#173b4a', 1.2, 4)}
    {corner({ left: 36, top: 36, borderLeftWidth: 2, borderTopWidth: 2 })}{corner({ right: 36, top: 36, borderRightWidth: 2, borderTopWidth: 2 })}
    {corner({ left: 36, bottom: 36, borderLeftWidth: 2, borderBottomWidth: 2 })}{corner({ right: 36, bottom: 36, borderRightWidth: 2, borderBottomWidth: 2 })}
    {hud}
  </AbsoluteFill>;
};

/** Typewriter with a blinking cursor. */
export const Typewriter: React.FC<{ text: string; startFrame?: number; charsPerSecond?: number; size?: number }> = ({ text, startFrame = 0, charsPerSecond = 11, size = 118 }) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig(), shown = clamp(Math.floor((f - startFrame) / fps * charsPerSecond), 0, text.length);
  const blink = Math.floor(f / 12) % 2 === 0 || shown < text.length;
  return <span style={{ fontSize: size, fontWeight: 700, letterSpacing: -2, color: colors.ink }}>{text.slice(0, shown)}<span style={{ opacity: blink ? 1 : 0, color: colors.accent }}>|</span></span>;
};

/** Circular progress ring with a centre label. */
export const Ring: React.FC<{ progress: number; label: string; sub?: string; size?: number }> = ({ progress, label, sub, size = 112 }) => {
  const r = size / 2 - 7, c = 2 * Math.PI * r;
  return <div style={{ position: 'relative', width: size, height: size }}>
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <defs><linearGradient id="ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={colors.accent}/><stop offset="1" stopColor={colors.accent2}/></linearGradient></defs>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,.12)" strokeWidth={5}/>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="url(#ring)" strokeWidth={5} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - clamp(progress))}/>
    </svg>
    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center', color: colors.ink }}>
      <div><div style={{ fontSize: size * .34, fontWeight: 700, lineHeight: 1 }}>{label}</div>{sub ? <div style={{ fontSize: size * .14, opacity: .6, marginTop: 4, letterSpacing: 1 }}>{sub}</div> : null}</div>
    </div>
  </div>;
};

/** Glass chip that springs in. */
export const Chip: React.FC<{ text: string; delay: number; hue?: string }> = ({ text, delay, hue = colors.accent }) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig(), s = spring({ frame: f - delay, fps, config: { damping: 14, stiffness: 120 } });
  return <div style={{ opacity: clamp(s), transform: `translateY(${(1 - s) * 26}px) scale(${.92 + .08 * s})`, display: 'inline-flex', alignItems: 'center', gap: 10, padding: '12px 22px', borderRadius: 999, background: colors.glass, border: `1px solid ${colors.glassLine}`, backdropFilter: 'blur(8px)', color: colors.ink, fontSize: 26, fontWeight: 600 }}>
    <span style={{ width: 10, height: 10, borderRadius: 5, background: hue, boxShadow: `0 0 14px ${hue}` }}/>{text}
  </div>;
};

/** Caption words lit as they are spoken: spoken words stay bright, the active word is highlighted, later words are dim. */
export const Captions: React.FC<{ words: { word: string; start: number; end: number }[]; startFrame: number; size?: number }> = ({ words, startFrame, size = 46 }) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig(), t = (f - startFrame) / fps;
  return <div style={{ fontSize: size, lineHeight: 1.34, fontWeight: 600, color: colors.ink, letterSpacing: -.5 }}>
    {words.map((w, i) => {
      const state = t >= w.end ? 'done' : t >= w.start ? 'active' : 'next', p = state === 'active' ? smootherstep((t - w.start) / Math.max(.08, w.end - w.start)) : 0;
      return <span key={i} style={{ display: 'inline-block', opacity: state === 'next' ? .3 : state === 'done' ? .92 : 1, transform: state === 'active' ? `translateY(${-3 * Math.sin(Math.PI * p)}px)` : 'none',
        color: state === 'active' ? '#fff' : colors.ink, textShadow: state === 'active' ? `0 0 28px ${colors.accent}aa` : 'none',
        backgroundImage: state === 'active' ? `linear-gradient(90deg, ${colors.accent}55 ${p * 100}%, transparent ${p * 100}%)` : 'none', borderRadius: 8, padding: '0 4px', marginLeft: -4, marginRight: 'calc(.28em - 4px)' }}>{w.word}</span>;
    })}
  </div>;
};

/** Fade in at the start and out at the end of a scene. */
export const useSceneOpacity = (frames: number, fadeIn = 10, fadeOut = 10) => {
  const f = useCurrentFrame();
  return interpolate(f, [0, fadeIn, frames - fadeOut, frames], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
};

/** Voice-reactive wave: bars driven by the narration loudness of the last few frames, travelling left to right. */
export const Waveform: React.FC<{ levels: number[]; startFrame: number; width: number; height: number; opacity?: number }> = ({ levels, startFrame, width, height, opacity = 1 }) => {
  const f = useCurrentFrame(), bars = 56, gap = 6, barW = (width - gap * (bars - 1)) / bars;
  return <svg width={width} height={height} style={{ opacity, overflow: 'visible' }}>
    <defs><linearGradient id="wave" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor={colors.accent}/><stop offset="1" stopColor={colors.accent2}/></linearGradient></defs>
    {Array.from({ length: bars }, (_, i) => {
      // Bar i shows the loudness from i frames ago, so the pattern flows across the width as the narrator speaks.
      const idx = f - startFrame - Math.round((bars - 1 - i) * 0.8), level = idx >= 0 && idx < levels.length ? levels[idx] : 0;
      const h = Math.max(6, level * height * (0.55 + 0.45 * Math.sin(i * 0.7 + f / 9) ** 2));
      return <rect key={i} x={i * (barW + gap)} y={(height - h) / 2} width={barW} height={h} rx={barW / 2} fill="url(#wave)" opacity={0.35 + 0.65 * level}/>;
    })}
  </svg>;
};
