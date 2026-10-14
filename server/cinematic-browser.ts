import * as THREE from 'three';
import { cinematicFov, type CinematicPose } from '../shared/cinematic';

interface Setup { imageUrl: string; gridWidth: number; gridHeight: number; width: number; height: number; tile: { x: number; y: number; width: number; height: number }; background: string; depthBlur: number }
declare global { interface Window { sixTileCamera: { initialize: (s: Setup) => Promise<void>; frame: (poses: CinematicPose[]) => string; webgl: () => string } } }

let renderer: THREE.WebGLRenderer | undefined, scene: THREE.Scene, camera: THREE.PerspectiveCamera, layer: THREE.Mesh, shadow: THREE.Mesh, blurred: THREE.Mesh, cover: THREE.Mesh, sweep: THREE.Mesh, sweepTexture: THREE.CanvasTexture, setup: Setup;
let accumulate: CanvasRenderingContext2D, output: CanvasRenderingContext2D, accumulateCanvas: HTMLCanvasElement, outputCanvas: HTMLCanvasElement;

function softShadowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d')!; g.filter = 'blur(10px)'; g.fillStyle = '#000'; g.fillRect(24, 24, 80, 80);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function streakTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 8; const g = c.getContext('2d')!, grad = g.createLinearGradient(0, 0, 512, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0)'); grad.addColorStop(.42, 'rgba(255,244,220,0)'); grad.addColorStop(.5, 'rgba(255,246,225,1)'); grad.addColorStop(.58, 'rgba(255,244,220,0)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 512, 8);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.ClampToEdgeWrapping; return t;
}
function blurredTexture(image: HTMLImageElement, blurPx: number) {
  const c = document.createElement('canvas'); c.width = setup.gridWidth; c.height = setup.gridHeight; const g = c.getContext('2d')!;
  g.fillStyle = setup.background; g.fillRect(0, 0, c.width, c.height); g.filter = `blur(${blurPx}px)`; g.drawImage(image, 0, 0, c.width, c.height);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; return t;
}
function placeCamera(pose: CinematicPose) {
  const cx = pose.centerX - setup.gridWidth / 2, cy = setup.gridHeight / 2 - pose.centerY;
  camera.position.set(cx + pose.offsetX, cy + pose.offsetY, pose.offsetZ);
  camera.up.set(Math.sin(pose.roll), Math.cos(pose.roll), 0); camera.lookAt(cx, cy, 0); camera.updateMatrixWorld();
  const tx = setup.tile.x + setup.tile.width / 2 - setup.gridWidth / 2, ty = setup.gridHeight / 2 - (setup.tile.y + setup.tile.height / 2), f = pose.liftScale;
  const focus = pose.blurOpacity > 1e-4, landing = pose.groundFade > 1e-4, floating = pose.lift > 1e-6 || focus || landing;
  cover.visible = landing; (cover.material as THREE.MeshBasicMaterial).opacity = pose.groundFade;
  blurred.visible = focus; (blurred.material as THREE.MeshBasicMaterial).opacity = pose.blurOpacity;
  layer.visible = floating; shadow.visible = floating && pose.shadow > 1e-4; sweep.visible = pose.sweepStrength > 1e-3 && floating;
  if (floating) {
    const z = pose.lift + 1, px = cx + (tx - cx) * f, py = cy + (ty - cy) * f;
    // Scaling about the view axis keeps the floating tile exactly over its place in the grid when the camera is straight-on.
    layer.position.set(px, py, z); layer.scale.set(f, f, 1);
    shadow.position.set(px + pose.lift * 0.06, py - pose.lift * 0.10, z * 0.5 + .6); shadow.scale.set(f, f, 1); (shadow.material as THREE.MeshBasicMaterial).opacity = pose.shadow;
    sweep.position.set(px, py, z + .5); sweep.scale.set(f, f, 1); (sweep.material as THREE.MeshBasicMaterial).opacity = pose.sweepStrength;
    sweepTexture.offset.x = -0.4 + pose.sweepPosition * 1.1;
  }
}
window.sixTileCamera = {
  webgl: () => { try { const c = document.createElement('canvas'); return c.getContext('webgl2') || c.getContext('webgl') ? 'ok' : 'unavailable'; } catch { return 'unavailable'; } },
  initialize: async s => {
    setup = s; renderer?.dispose();
    const canvas = document.createElement('canvas'); document.body.replaceChildren(canvas);
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: false });
    renderer.setPixelRatio(1); renderer.setSize(s.width, s.height, false); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.setClearColor(new THREE.Color(s.background), 1);
    const image = await new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('Grid image failed to load.')); i.src = s.imageUrl; });
    const texture = new THREE.Texture(image); texture.needsUpdate = true; texture.colorSpace = THREE.SRGBColorSpace; texture.generateMipmaps = true; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter; texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    scene = new THREE.Scene();
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(s.gridWidth, s.gridHeight), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })));
    blurred = new THREE.Mesh(new THREE.PlaneGeometry(s.gridWidth, s.gridHeight), new THREE.MeshBasicMaterial({ map: blurredTexture(image, Math.max(0.5, s.depthBlur)), transparent: true, opacity: 0, depthWrite: false, toneMapped: false })); blurred.position.z = .4; blurred.visible = false; scene.add(blurred);
    cover = new THREE.Mesh(new THREE.PlaneGeometry(s.gridWidth * 4, s.gridHeight * 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(s.background), transparent: true, opacity: 0, depthWrite: false, toneMapped: false })); cover.position.z = .8; cover.visible = false; scene.add(cover);
    shadow = new THREE.Mesh(new THREE.PlaneGeometry(s.tile.width * 1.18, s.tile.height * 1.18), new THREE.MeshBasicMaterial({ map: softShadowTexture(), transparent: true, opacity: 0, depthWrite: false, toneMapped: false })); scene.add(shadow);
    const geometry = new THREE.PlaneGeometry(s.tile.width, s.tile.height), uv = geometry.attributes.uv as THREE.BufferAttribute;
    const u0 = s.tile.x / s.gridWidth, u1 = (s.tile.x + s.tile.width) / s.gridWidth, v1 = 1 - s.tile.y / s.gridHeight, v0 = 1 - (s.tile.y + s.tile.height) / s.gridHeight;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) === 0 ? u0 : u1, uv.getY(i) === 0 ? v0 : v1);
    layer = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })); scene.add(layer);
    sweepTexture = streakTexture(); sweepTexture.repeat.set(1 / 3, 1);
    sweep = new THREE.Mesh(new THREE.PlaneGeometry(s.tile.width, s.tile.height), new THREE.MeshBasicMaterial({ map: sweepTexture, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })); scene.add(sweep);
    camera = new THREE.PerspectiveCamera(cinematicFov, s.width / s.height, 10, 100000);
    accumulateCanvas = document.createElement('canvas'); outputCanvas = document.createElement('canvas');
    for (const c of [accumulateCanvas, outputCanvas]) { c.width = s.width; c.height = s.height; }
    accumulate = accumulateCanvas.getContext('2d', { willReadFrequently: false })!; output = outputCanvas.getContext('2d')!;
  },
  frame: poses => {
    if (!renderer || !poses.length) throw new Error('Cinematic renderer not initialized.');
    const { width, height } = setup;
    // Motion blur: average the sub-frames across the shutter, in order, with a running mean.
    poses.forEach((pose, i) => { placeCamera(pose); renderer!.render(scene, camera); accumulate.globalAlpha = 1 / (i + 1); accumulate.drawImage(renderer!.domElement, 0, 0); });
    accumulate.globalAlpha = 1;
    const mid = poses[Math.floor(poses.length / 2)];
    output.globalAlpha = 1; output.filter = (mid.contrast > 1e-4 || mid.warmth > 1e-4) ? `contrast(${1 + mid.contrast}) saturate(${1 + mid.contrast * .6 + mid.warmth * .5}) sepia(${mid.warmth * .45})` : 'none';
    output.drawImage(accumulateCanvas, 0, 0); output.filter = 'none';
    if (mid.vignette > 1e-4) {
      const g = output.createRadialGradient(width / 2, height / 2, Math.min(width, height) * .28, width / 2, height / 2, Math.hypot(width, height) / 2);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${Math.min(.9, mid.vignette * 1.4)})`); output.fillStyle = g; output.fillRect(0, 0, width, height);
    }
    return outputCanvas.toDataURL('image/png');
  },
};
