import type { OutputFormat } from './layout';

export const TEXT_FPS = 30;
export interface TextPresetDefinition { label:string;description:string;kind:'particles'|'camera'|'lighting';solidRange:readonly [number,number];cameraReveal:boolean }
export const textPresets = {
  'particle-assembly': { label: 'Particle assembly', description: 'Seeded surface particles converge into bevelled lettering.',kind:'particles',solidRange:[19/29,26/29],cameraReveal:false },
  'camera-fly-through': { label: 'Camera fly-through', description: 'Perspective camera keyframes end on the complete word.',kind:'camera',solidRange:[0,0],cameraReveal:false },
  'environmental': { label: 'Environmental 3D text', description: 'Moving cinematic lights reveal reflective typography.',kind:'lighting',solidRange:[0,.65],cameraReveal:true },
} as const satisfies Record<string,TextPresetDefinition>;
// Extension planning is explicit: these names are not exposed as functioning presets.
export const secondaryTextEffects=['Metallic light sweep','Fragment reconstruction','Light-trail construction','Volumetric emergence','Glass refraction','Depth burst','Letter-by-letter 3D reveal','Text disintegration'] as const;
export type TextPreset = keyof typeof textPresets;
export type TextMaterial = 'gold' | 'ivory' | 'silver' | 'glass' | 'illuminated-gold' | 'custom';
export type Vec3 = { x: number; y: number; z: number };
export interface TextEffect {
  id: string; text: string; format: OutputFormat | 'both'; preset: TextPreset;
  font: 'helvetiker' | 'optimer' | 'gentilis'; fontSize: number; letterSpacing: number; align: 'left' | 'center' | 'right';
  depth: number; bevel: number; bevelThickness?:number; bevelSegments: number;
  position: Vec3; rotation: Vec3; scale: number; opacity: number; layer: number;
  start: number; animationDuration: number; visibilityDuration: number; exit: 'cut' | 'fade'; exitDuration: number;
  material: TextMaterial; color: string; metalness: number; roughness: number;
  lighting: number; reflection: number; glow: number; fog: number; softShadow: boolean;
  environment: 'studio' | 'none' | 'hdr'; hdrAsset?: { id: string; sha256: string };
  seed: number; particleCount: number; particleSize: number; spread: number; intensity: number;
  easing: 'smooth' | 'linear' | 'cubic'; speed: number; direction: 'left' | 'right';
  camera: { fov: number; target: Vec3; keyframes: { at: number; position: Vec3 }[] };
}
export interface TextTrack { version: 1; objects: TextEffect[] }
export interface TextExportJob { id:string;projectId:string;format:OutputFormat;objectId:string;settingsRevision?:number;status:'running'|'complete'|'failed'|'cancelled';progress:number;message:string;error?:string;frameCount?:number;downloadUrl?:string;manifestUrl?:string;sha256?:string }
export const emptyTextTrack = (): TextTrack => ({ version: 1, objects: [] });
export function defaultTextEffect(id: string, format: TextEffect['format'] = 'both'): TextEffect {
  return { id, text: 'UNDERSTANDING', format, preset: 'particle-assembly', font: 'helvetiker', fontSize: 1, letterSpacing: .035, align: 'center', depth: .22, bevel: .035, bevelThickness:.035, bevelSegments: 3,
    position: { x: 0, y: 0, z: 0 }, rotation: { x: 4, y: -8, z: 0 }, scale: 1, opacity: 1, layer: 0, start: 0, animationDuration: 1, visibilityDuration: 3, exit: 'cut', exitDuration: .3,
    material: 'gold', color: '#d6a43c', metalness: .95, roughness: .23, lighting: 3, reflection: 1, glow: .15, fog: 0, softShadow: false, environment: 'studio', seed: 42, particleCount: 2500, particleSize: .025, spread: 3, intensity: 1, easing: 'smooth', speed: 1, direction: 'left',
    camera: { fov: 35, target: { x: 0, y: 0, z: 0 }, keyframes: [{ at: 0, position: { x: -3, y: 1, z: 3 } }, { at: .5, position: { x: 2, y: .5, z: 10 } }, { at: 1, position: { x: 0, y: 0, z: 18 } }] } };
}
export const textFrames = (seconds: number) => Math.ceil(seconds * TEXT_FPS - 1e-9);
// Chromium reports media timestamps at microsecond precision, slightly below n/30.
export const displayedTextFrame=(seconds:number)=>Number.isFinite(seconds)?Math.max(0,Math.floor(seconds*TEXT_FPS+1e-4)):0;
export function textRange(o: TextEffect) {
  const start = textFrames(o.start), animation = Math.max(1, textFrames(o.animationDuration)), hold = textFrames(o.visibilityDuration), exit = o.exit === 'fade' ? textFrames(o.exitDuration) : 0;
  return { start, animation, hold, exit, end: start + animation + hold + exit };
}
export const appliesTo = (o: TextEffect, format: OutputFormat) => o.format === 'both' || o.format === format;
export function easeText(p: number, easing: TextEffect['easing']) { p = Math.max(0, Math.min(1, p)); return easing === 'linear' ? p : easing === 'cubic' ? p < .5 ? 4*p*p*p : 1-Math.pow(-2*p+2,3)/2 : p*p*(3-2*p); }
export function textState(o: TextEffect, frame: number) {
  const r = textRange(o), local = frame - r.start, raw = r.animation===1?(local>=0?1:0):Math.max(0, Math.min(1, local / (r.animation - 1))), p = easeText(Math.pow(raw, 1/o.speed), o.easing);
  const fade = r.exit && local >= r.animation + r.hold ? 1 - (local - r.animation - r.hold + 1) / r.exit : 1;
  const [a,b]=textPresets[o.preset].solidRange;
  return { visible: local >= 0 && frame < r.end, localFrame: local, progress: p, rawProgress: raw, opacity: Math.max(0, o.opacity * fade), solid: a===b?1:easeText((raw-a)/(b-a),'smooth') };
}
export function seededRandom(seed: number) { let s=seed>>>0; return () => { s += 0x6d2b79f5; let t=Math.imul(s^(s>>>15),1|s); t^=t+Math.imul(t^(t>>>7),61|t); return ((t^(t>>>14))>>>0)/4294967296; }; }
export function cameraAt(o: TextEffect, p: number): Vec3 {
  const keys=o.camera.keyframes; let b=keys.findIndex(k=>k.at>=p); if(b<=0)return {...keys[b===0?0:keys.length-1].position}; const a=keys[b-1], z=keys[b], t=(p-a.at)/(z.at-a.at); return {x:a.position.x+(z.position.x-a.position.x)*t,y:a.position.y+(z.position.y-a.position.y)*t,z:a.position.z+(z.position.z-a.position.z)*t};
}
export function validateTextTrack(value: unknown): string[] {
  if(value===undefined)return [];
  const t=value as TextTrack, fail=(s:string)=>[s], bounded=(n:number,a:number,b:number)=>Number.isFinite(n)&&n>=a&&n<=b, vector=(v:Vec3,limit:number)=>v&&[v.x,v.y,v.z].every(n=>bounded(n,-limit,limit));
  if(!t||t.version!==1||!Array.isArray(t.objects)||t.objects.length>16)return fail('Text track version 1 supports up to 16 objects.');
  const ids=new Set<string>(); let particles=0;
  for(const o of t.objects){
    if(!o||typeof o.id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(o.id)||ids.has(o.id))return fail('Text object IDs must be unique safe identifiers.'); ids.add(o.id);
    if(typeof o.text!=='string'||!o.text.trim()||o.text.length>64||/[\r\n\x00-\x1f]/.test(o.text))return fail('Enter 1–64 printable characters on one line.');
    if(!['mobile','desktop','both'].includes(o.format)||!Object.hasOwn(textPresets,o.preset)||!['helvetiker','optimer','gentilis'].includes(o.font)||!['left','center','right'].includes(o.align)||!['gold','ivory','silver','glass','illuminated-gold','custom'].includes(o.material)||!['smooth','linear','cubic'].includes(o.easing)||!['left','right'].includes(o.direction)||!['cut','fade'].includes(o.exit)||!['studio','none','hdr'].includes(o.environment))return fail('Invalid text preset, font, material or animation option.');
    if(!bounded(o.fontSize,.1,4)||!bounded(o.letterSpacing,-.05,1)||!bounded(o.depth,.001,2)||!bounded(o.bevel,0,.2)||!bounded(o.bevelThickness??o.bevel,0,.5)||!Number.isInteger(o.bevelSegments)||!bounded(o.bevelSegments,1,8)||!vector(o.position,100)||!bounded(o.position.x,-1,1)||!bounded(o.position.y,-1,1)||!vector(o.rotation,360)||!bounded(o.scale,.05,5)||!bounded(o.opacity,0,1)||!Number.isInteger(o.layer)||!bounded(o.layer,0,100))return fail('Text geometry or position is outside supported limits.');
    if(!bounded(o.start,0,3600)||!bounded(o.animationDuration,1/30,30)||!bounded(o.visibilityDuration,0,600)||!bounded(o.exitDuration,1/30,10)||!bounded(o.speed,.25,4))return fail('Invalid text start, animation, completed visibility, exit duration or speed.');
    if(typeof o.color!=='string'||!/^#[0-9a-f]{6}$/i.test(o.color)||![o.metalness,o.roughness,o.fog].every(n=>bounded(n,0,1))||!bounded(o.lighting,0,10)||!bounded(o.reflection,0,5)||!bounded(o.glow,0,2)||typeof o.softShadow!=='boolean')return fail('Invalid text lighting or material settings.');
    if(!Number.isInteger(o.seed)||!bounded(o.seed,0,4294967295)||!Number.isInteger(o.particleCount)||!bounded(o.particleCount,100,12000)||!bounded(o.particleSize,.005,.2)||!bounded(o.spread,0,10)||!bounded(o.intensity,0,5))return fail('Invalid particle settings (100–12000 particles per object).');particles+=o.preset==='particle-assembly'?o.particleCount:0;
    if(!o.camera||!bounded(o.camera.fov,20,90)||!vector(o.camera.target,100)||!Array.isArray(o.camera.keyframes)||o.camera.keyframes.length<2||o.camera.keyframes.length>8||o.camera.keyframes[0].at!==0||o.camera.keyframes.at(-1)!.at!==1)return fail('Camera requires 2–8 keyframes covering 0 to 1.');
    let prev=-1;for(const k of o.camera.keyframes){if(!k||!bounded(k.at,0,1)||k.at<=prev||!vector(k.position,100)||k.position.z<.5)return fail('Camera keyframes must be ordered and in front of the text.');prev=k.at;}
    if(o.environment==='hdr'&&(!o.hdrAsset||!/^[a-f0-9-]{36}$/i.test(o.hdrAsset.id)||!/^[a-f0-9]{64}$/.test(o.hdrAsset.sha256)))return fail('Import a local HDR environment before selecting HDR reflections.');
  }
  return particles>48000?fail('Limit the combined particle budget to 48000.'):[];
}
