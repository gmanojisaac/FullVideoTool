import * as THREE from 'three';
import { cinematicFov, type CinematicPose } from '../shared/cinematic';

interface Setup { imageUrl: string; gridWidth: number; gridHeight: number; width: number; height: number; tile: { x: number; y: number; width: number; height: number }; background: string }
declare global { interface Window { sixTileCamera: { initialize: (s: Setup) => Promise<void>; frame: (pose: CinematicPose) => string; webgl: () => string } } }

let renderer: THREE.WebGLRenderer | undefined, scene: THREE.Scene, camera: THREE.PerspectiveCamera, layer: THREE.Mesh, shadow: THREE.Mesh, setup: Setup;
function softShadowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d')!; g.filter = 'blur(10px)'; g.fillStyle = '#000'; g.fillRect(24, 24, 80, 80);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
window.sixTileCamera = {
  webgl: () => { try { const c = document.createElement('canvas'); return c.getContext('webgl2') || c.getContext('webgl') ? 'ok' : 'unavailable'; } catch { return 'unavailable'; } },
  initialize: async s => {
    setup = s; renderer?.dispose();
    const canvas = document.createElement('canvas'); document.body.replaceChildren(canvas);
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: false });
    renderer.setPixelRatio(1); renderer.setSize(s.width, s.height, false); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.setClearColor(new THREE.Color(s.background), 1);
    const texture = await new THREE.TextureLoader().loadAsync(s.imageUrl); texture.colorSpace = THREE.SRGBColorSpace; texture.generateMipmaps = true; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter; texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    scene = new THREE.Scene();
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(s.gridWidth, s.gridHeight), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })); scene.add(ground);
    shadow = new THREE.Mesh(new THREE.PlaneGeometry(s.tile.width * 1.18, s.tile.height * 1.18), new THREE.MeshBasicMaterial({ map: softShadowTexture(), transparent: true, opacity: 0, depthWrite: false, toneMapped: false })); scene.add(shadow);
    const geometry = new THREE.PlaneGeometry(s.tile.width, s.tile.height), uv = geometry.attributes.uv as THREE.BufferAttribute;
    const u0 = s.tile.x / s.gridWidth, u1 = (s.tile.x + s.tile.width) / s.gridWidth, v1 = 1 - s.tile.y / s.gridHeight, v0 = 1 - (s.tile.y + s.tile.height) / s.gridHeight;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) === 0 ? u0 : u1, uv.getY(i) === 0 ? v0 : v1);
    layer = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })); scene.add(layer);
    camera = new THREE.PerspectiveCamera(cinematicFov, s.width / s.height, 10, 100000);
  },
  frame: pose => {
    if (!renderer) throw new Error('Cinematic renderer not initialized.');
    const cx = pose.centerX - setup.gridWidth / 2, cy = setup.gridHeight / 2 - pose.centerY;
    camera.position.set(cx + pose.offsetX, cy + pose.offsetY, pose.distance); camera.up.set(0, 1, 0); camera.lookAt(cx, cy, 0); camera.updateMatrixWorld();
    const floating = pose.lift > 1e-6, tx = setup.tile.x + setup.tile.width / 2 - setup.gridWidth / 2, ty = setup.gridHeight / 2 - (setup.tile.y + setup.tile.height / 2), f = pose.liftScale;
    layer.visible = floating; shadow.visible = floating;
    if (floating) {
      // Scaling about the view axis keeps the floating tile exactly over its place in the grid when the camera is straight-on.
      layer.position.set(cx + (tx - cx) * f, cy + (ty - cy) * f, pose.lift); layer.scale.set(f, f, 1);
      shadow.position.set(cx + (tx - cx) * f + pose.lift * 0.06, cy + (ty - cy) * f - pose.lift * 0.10, pose.lift * 0.5); shadow.scale.set(f, f, 1); (shadow.material as THREE.MeshBasicMaterial).opacity = pose.shadow;
    }
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
  },
};
