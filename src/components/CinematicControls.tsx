import { cinematicEasings, cinematicPresetNames, cinematicPresets, cinematicRanges, defaultCinematicSettings, validateCinematicSettings, type CinematicNumericKey, type CinematicSettings } from '../../shared/cinematic';

interface Props { settings: CinematicSettings | undefined; disabled: boolean; onChange: (s: CinematicSettings) => void }
const groups: { title: string; keys: CinematicNumericKey[] }[] = [
  { title: 'Camera move', keys: ['orbitDegrees', 'craneDegrees', 'rollDegrees', 'panLead', 'overshoot', 'arcShape'] },
  { title: 'Floating tile', keys: ['lift', 'shadow', 'lightSweep'] },
  { title: 'Look', keys: ['depthBlur', 'motionBlur', 'vignette', 'warmth', 'contrast'] },
];
const easingLabels: Record<string, string> = { smootherstep: 'Smooth (quintic)', cubic: 'Cubic in/out', expo: 'Expo (fast middle)', outCubic: 'Ease-out (fast start)', linear: 'Linear' };

export default function CinematicControls({ settings, disabled, onChange }: Props) {
  const s = settings || defaultCinematicSettings(), errors = validateCinematicSettings(s);
  const set = (patch: Partial<CinematicSettings>) => onChange({ ...s, ...patch, preset: 'custom' });
  const preset = s.preset === 'custom' ? null : cinematicPresets[s.preset];
  return <section className="cinematic-controls" aria-label="Cinematic camera settings">
    <div className="cinematic-head">
      <label>Preset<select aria-label="Cinematic preset" disabled={disabled} value={s.preset} onChange={e => { const name = e.target.value; if (name !== 'custom') onChange({ ...cinematicPresets[name as keyof typeof cinematicPresets].settings }); else onChange({ ...s, preset: 'custom' }); }}>
        {cinematicPresetNames.map(n => <option key={n} value={n}>{cinematicPresets[n].label}</option>)}<option value="custom">Custom (edited)</option></select></label>
      <label>Easing<select aria-label="Cinematic easing" disabled={disabled} value={s.easing} onChange={e => set({ easing: e.target.value as CinematicSettings['easing'] })}>{cinematicEasings.map(n => <option key={n} value={n}>{easingLabels[n]}</option>)}</select></label>
    </div>
    <p className="cinematic-description">{preset ? preset.description : 'Custom settings. Pick a preset to start from one of the designed looks.'}</p>
    <div className="cinematic-groups">
      {groups.map(g => <fieldset key={g.title}><legend>{g.title}</legend>
        {g.keys.map(k => { const r = cinematicRanges[k]; return <label key={k} className="cinematic-slider"><span>{r.label}</span>
          <input type="range" aria-label={r.label} min={r.min} max={r.max} step={r.step} value={s[k]} disabled={disabled} onChange={e => set({ [k]: Number(e.target.value) } as Partial<CinematicSettings>)}/>
          <output>{Number.isInteger(r.step) ? s[k] : s[k].toFixed(2)}</output></label>; })}
      </fieldset>)}
    </div>
    {errors.length ? <p className="message error" role="alert">{errors.join(' ')}</p> : null}
    <p className="cinematic-note">Every effect is zero at the first and last frame of the move, so the grid hold before it and the dissolve after it match exactly. Motion blur and depth blur make renders slower.</p>
  </section>;
}
