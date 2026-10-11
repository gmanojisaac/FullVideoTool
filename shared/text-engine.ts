import * as THREE from 'three';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import { FontLoader, type Font } from 'three/examples/jsm/loaders/FontLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import helvetiker from 'three/examples/fonts/helvetiker_bold.typeface.json';
import optimer from 'three/examples/fonts/optimer_bold.typeface.json';
import gentilis from 'three/examples/fonts/gentilis_bold.typeface.json';
import { cameraAt, seededRandom, textState, validateTextTrack, textPresets, type TextEffect } from './text-effects';

const loader=new FontLoader();
const fonts:Record<TextEffect['font'],Font>={helvetiker:loader.parse(helvetiker),optimer:loader.parse(optimer),gentilis:loader.parse(gentilis)};
export function buildTextGeometry(o:TextEffect):THREE.BufferGeometry {
  const font=fonts[o.font], parts:THREE.BufferGeometry[]=[]; let cursor=0;
  try {
    for(const char of o.text){const glyph=font.data.glyphs[char];if(!glyph)throw new Error(`The ${o.font} font does not contain “${char}”. Choose supported Latin text.`);
      if(char!==' '){const g=new TextGeometry(char,{font,size:o.fontSize,depth:o.depth,curveSegments:8,bevelEnabled:o.bevel>0,bevelThickness:o.bevelThickness??o.bevel,bevelSize:o.bevel,bevelSegments:o.bevelSegments});g.translate(cursor,0,0);parts.push(g);}
      cursor+=glyph.ha/font.data.resolution*o.fontSize+o.letterSpacing;
    }
    if(!parts.length)throw new Error('Enter visible text.');const g=mergeGeometries(parts,false)!;g.computeBoundingBox();const b=g.boundingBox!, dx=o.align==='left'?-b.min.x:o.align==='right'?-b.max.x:-(b.min.x+b.max.x)/2;
    g.translate(dx,-(b.min.y+b.max.y)/2,-(b.min.z+b.max.z)/2);g.computeBoundingBox();g.computeBoundingSphere();g.userData.text=o.text;return g;
  } finally {parts.forEach(p=>p.dispose());}
}
const geometryKey=(o:TextEffect)=>JSON.stringify([o.text,o.font,o.fontSize,o.letterSpacing,o.align,o.depth,o.bevel,o.bevelThickness??o.bevel,o.bevelSegments]);
export class TextGeometryCache {
  private entries=new Map<string,{geometry:THREE.BufferGeometry;refs:number}>();
  acquire(o:TextEffect){const key=geometryKey(o);let entry=this.entries.get(key);if(!entry){entry={geometry:buildTextGeometry(o),refs:0};this.entries.set(key,entry);}entry.refs++;return {geometry:entry.geometry,release:()=>{entry!.refs--;this.trim();}};}
  private trim(){for(const [key,e] of this.entries){if(this.entries.size<=8)break;if(!e.refs){e.geometry.dispose();this.entries.delete(key);}}}
  dispose(){this.entries.forEach(e=>e.geometry.dispose());this.entries.clear();}
}
export function particleLayout(g:THREE.BufferGeometry,o:TextEffect) {
  const p=g.getAttribute('position'), index=g.index, count=(index?index.count:p.count)/3, cumulative=new Float64Array(count);let total=0;const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),ab=new THREE.Vector3(),ac=new THREE.Vector3();
  const vertex=(i:number,v:THREE.Vector3)=>v.fromBufferAttribute(p,index?index.getX(i):i);
  for(let i=0;i<count;i++){vertex(i*3,a);vertex(i*3+1,b);vertex(i*3+2,c);total+=ab.subVectors(b,a).cross(ac.subVectors(c,a)).length()/2;cumulative[i]=total;}
  const rng=seededRandom(o.seed),target=new Float32Array(o.particleCount*3),origin=new Float32Array(target.length);
  for(let i=0;i<o.particleCount;i++){const sample=rng()*total;let lo=0,hi=count-1;while(lo<hi){const mid=(lo+hi)>>>1;if(cumulative[mid]<sample)lo=mid+1;else hi=mid;}vertex(lo*3,a);vertex(lo*3+1,b);vertex(lo*3+2,c);const u=Math.sqrt(rng()),v=rng();
    for(let k=0;k<3;k++){const axis=k===0?'x':k===1?'y':'z';target[i*3+k]=(1-u)*a[axis]+u*(1-v)*b[axis]+u*v*c[axis];origin[i*3+k]=target[i*3+k]+(rng()-.5)*2*o.spread*o.intensity+(k===0?(o.direction==='left'?-1:1)*o.spread:0);}
  }return {target,origin};
}
export function textMaterial(o:TextEffect) {
  const presets={gold:{color:'#d6a43c',metalness:.95,roughness:.23},ivory:{color:'#fff0d6',metalness:.15,roughness:.45},silver:{color:'#dce5ec',metalness:1,roughness:.15},glass:{color:'#d8f4ff',metalness:0,roughness:.08},'illuminated-gold':{color:'#efbb4f',metalness:.8,roughness:.2},custom:{color:o.color,metalness:o.metalness,roughness:o.roughness}};
  const material=new THREE.MeshPhysicalMaterial({...presets[o.material],transparent:true,opacity:o.opacity,envMapIntensity:o.reflection,clearcoat:.7,clearcoatRoughness:.12,depthWrite:true});
  if(o.material==='glass'){// Transparent reflective glass; alpha remains usable over footage without an opaque transmission buffer.
    material.opacity=o.opacity*.38;material.ior=1.5;material.specularIntensity=1;material.metalness=0;material.side=THREE.DoubleSide;
  }
  if(o.material==='illuminated-gold'){material.emissive.set('#e7a629');material.emissiveIntensity=.55;}return material;
}
interface Model {o:TextEffect;scene:THREE.Scene;group:THREE.Group;mesh:THREE.Mesh;material:THREE.MeshPhysicalMaterial;camera:THREE.PerspectiveCamera;light:THREE.DirectionalLight;fill:THREE.DirectionalLight;points?:THREE.Points;positions?:Float32Array;target?:Float32Array;origin?:Float32Array;shadow?:THREE.Mesh;release:()=>void}
export class TextEngine {
  readonly renderer:THREE.WebGLRenderer; private cache=new TextGeometryCache();private models:Model[]=[];private env:THREE.WebGLRenderTarget;
  private hdrs=new Map<string,THREE.WebGLRenderTarget>();private width:number;private height:number;private target:THREE.WebGLRenderTarget;private blur:THREE.WebGLRenderTarget;private emptyScene=new THREE.Scene();private postScene=new THREE.Scene();private postCamera=new THREE.Camera();private post:THREE.ShaderMaterial;private postMesh:THREE.Mesh;private disposed=false;private revision=0;
  constructor(canvas:HTMLCanvasElement,width:number,height:number) {
    this.width=width;this.height=height;this.renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,preserveDrawingBuffer:true,premultipliedAlpha:true,powerPreference:'high-performance'});
    this.renderer.debug.onShaderError=()=>{throw new Error('The local WebGL driver could not compile the text shader. Update the graphics driver or try another local Chromium browser.');};
    this.renderer.setPixelRatio(1);this.renderer.setSize(width,height,false);this.renderer.setClearColor(0x000000,0);this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.1;this.renderer.autoClear=false;
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    const pmrem=new THREE.PMREMGenerator(this.renderer),room=new RoomEnvironment();this.env=pmrem.fromScene(room,.04);room.dispose();pmrem.dispose();
    this.target=new THREE.WebGLRenderTarget(width,height,{depthBuffer:true,samples:4});this.blur=new THREE.WebGLRenderTarget(Math.max(1,width>>1),Math.max(1,height>>1),{depthBuffer:false});
    this.post=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,transparent:true,premultipliedAlpha:true,blending:THREE.NormalBlending,uniforms:{base:{value:this.target.texture},halo:{value:this.blur.texture},resolution:{value:new THREE.Vector2(width,height)},strength:{value:0},mode:{value:0}},vertexShader:'varying vec2 uv2; void main(){uv2=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:`varying vec2 uv2;uniform sampler2D base;uniform sampler2D halo;uniform vec2 resolution;uniform float strength;uniform int mode;
      void main(){vec4 a=texture2D(base,uv2);if(mode==1){vec4 b=vec4(0.);for(int x=-2;x<=2;x++){for(int y=-2;y<=2;y++){b+=texture2D(base,uv2+vec2(float(x),float(y))*3./resolution)/25.;}}gl_FragColor=b;return;}
      vec4 b=texture2D(halo,uv2)*strength;gl_FragColor=vec4(a.rgb+b.rgb,min(1.,a.a+b.a));
      if(gl_FragColor.a>0.)gl_FragColor.rgb/=gl_FragColor.a;
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      gl_FragColor.rgb*=gl_FragColor.a;}`});
    this.postMesh=new THREE.Mesh(new THREE.PlaneGeometry(2,2),this.post);this.postScene.add(this.postMesh);
  }
  async setObjects(objects:TextEffect[],hdrUrl:(id:string)=>string=id=>'/hdr/'+id) {
    const revision=++this.revision;
    const errors=validateTextTrack({version:1,objects});if(errors.length)throw new Error(errors.join(' '));
    for(const o of objects)if(o.environment==='hdr'&&o.hdrAsset&&!this.hdrs.has(o.hdrAsset.id)){const hdr=await new HDRLoader().loadAsync(hdrUrl(o.hdrAsset.id));if(this.disposed||revision!==this.revision){hdr.dispose();return;}const p=new THREE.PMREMGenerator(this.renderer);try{this.hdrs.set(o.hdrAsset.id,p.fromEquirectangular(hdr));}finally{hdr.dispose();p.dispose();}}
    if(this.disposed||revision!==this.revision)return;this.clearModels();
    const usedHdrs=new Set(objects.filter(o=>o.environment==='hdr'&&o.hdrAsset).map(o=>o.hdrAsset!.id));for(const [id,env] of this.hdrs)if(!usedHdrs.has(id)){env.dispose();this.hdrs.delete(id);}
    try{for(const o of [...objects].sort((a,b)=>a.layer-b.layer||a.id.localeCompare(b.id))){const lease=this.cache.acquire(o),material=textMaterial(o),scene=new THREE.Scene(),group=new THREE.Group(),mesh=new THREE.Mesh(lease.geometry,material),camera=new THREE.PerspectiveCamera(o.camera.fov,this.width/this.height,.1,300),light=new THREE.DirectionalLight('#fff3d4',o.lighting),fill=new THREE.DirectionalLight('#bfdcff',o.lighting*.65);
      scene.environment=o.environment==='none'?null:o.environment==='hdr'?this.hdrs.get(o.hdrAsset!.id)!.texture:this.env.texture;
      if(o.fog)scene.fog=new THREE.FogExp2('#241b16',o.fog*.04);
      light.position.set(-4,4,8);fill.position.set(4,-1,3);scene.add(new THREE.AmbientLight('#fff2d5',.5),light,fill,light.target);group.add(mesh);scene.add(group);mesh.castShadow=o.softShadow;
      const model:Model={o,scene,group,mesh,material,camera,light,fill,release:lease.release};
      if(o.softShadow){light.castShadow=true;light.shadow.mapSize.set(512,512);const shadow=new THREE.Mesh(new THREE.PlaneGeometry(30,20),new THREE.ShadowMaterial({opacity:.18,transparent:true}));shadow.position.z=-o.depth-.2;shadow.receiveShadow=true;group.add(shadow);model.shadow=shadow;}
      if(textPresets[o.preset].kind==='particles'){const {target,origin}=particleLayout(lease.geometry,o),positions=new Float32Array(origin),geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));const pointsMaterial=new THREE.PointsMaterial({color:'#ffd477',size:o.particleSize,transparent:true,opacity:1,depthWrite:false,sizeAttenuation:true});const points=new THREE.Points(geometry,pointsMaterial);points.frustumCulled=false;group.add(points);Object.assign(model,{points,positions,target,origin});}
      this.models.push(model);
    }}catch(e){this.clearModels();throw e;}
  }
  render(frame:number) {
    if(this.disposed)throw new Error('Text renderer has been disposed.');this.renderer.setRenderTarget(null);this.renderer.clear(true,true,true);
    const halfHeight=18*Math.tan(THREE.MathUtils.degToRad(35)/2),halfWidth=halfHeight*this.width/this.height;
    for(const m of this.models){const o=m.o,s=textState(o,Math.floor(frame));if(!s.visible)continue;m.group.position.set(o.position.x*halfWidth,o.position.y*halfHeight,o.position.z);m.group.rotation.set(...[o.rotation.x,o.rotation.y,o.rotation.z].map(THREE.MathUtils.degToRad) as [number,number,number]);const bounds=m.mesh.geometry.boundingBox!,wordWidth=bounds.max.x-bounds.min.x;const fit=Math.min(1,halfWidth*1.8/wordWidth);m.group.scale.setScalar(o.scale*fit);
      const definition=textPresets[o.preset];m.camera.fov=o.camera.fov;m.camera.updateProjectionMatrix();const c=definition.kind==='camera'?cameraAt(o,s.progress):{x:definition.cameraReveal?(o.direction==='left'?-1:1)*1.5*(1-s.progress):0,y:definition.cameraReveal?.5*(1-s.progress):0,z:18};
      if(definition.kind==='camera'&&o.direction==='right')c.x=-c.x;
      // Final fly-through framing automatically pulls back enough to show the complete transformed word.
      if(definition.kind==='camera'&&s.progress>.85){const b=new THREE.Box3().setFromObject(m.mesh),size=b.getSize(new THREE.Vector3()),required=Math.max(size.y,size.x/(this.width/this.height))/(2*Math.tan(THREE.MathUtils.degToRad(o.camera.fov)/2))*1.15;const blend=(s.progress-.85)/.15;c.x*=1-blend;c.y*=1-blend;c.z=Math.max(c.z,o.position.z+required*blend);}
      m.camera.position.set(c.x,c.y,c.z);m.camera.lookAt(o.camera.target.x,o.camera.target.y,o.camera.target.z);m.material.opacity=s.opacity*s.solid*(o.material==='glass'?.38:1);m.mesh.visible=m.material.opacity>0;
      m.light.position.x=definition.kind==='lighting'?(o.direction==='left'?1:-1)*(-6+12*s.progress):-4;m.light.intensity=o.lighting*(definition.kind==='lighting'?.35+.65*s.progress:1);m.material.envMapIntensity=o.reflection;
      if(m.shadow)(m.shadow.material as THREE.ShadowMaterial).opacity=.18*s.opacity*s.solid;
      if(m.points){const convergence=Math.pow(Math.min(1,s.rawProgress/(26/29)),1/o.speed),p=convergence*convergence*(3-2*convergence);for(let i=0;i<m.positions!.length;i++)m.positions![i]=m.origin![i]+(m.target![i]-m.origin![i])*p;m.points.geometry.getAttribute('position').needsUpdate=true;(m.points.material as THREE.PointsMaterial).opacity=s.opacity*(1-s.solid);m.points.visible=(m.points.material as THREE.PointsMaterial).opacity>0;}
      this.renderer.setRenderTarget(this.target);this.renderer.clear(true,true,true);this.renderer.render(this.emptyScene,this.postCamera);this.renderer.render(m.scene,m.camera);
      this.post.uniforms.mode.value=1;this.post.uniformsNeedUpdate=true;this.renderer.setRenderTarget(this.blur);this.renderer.clear();this.renderer.render(this.postScene,this.postCamera);
      this.post.uniforms.mode.value=0;this.post.uniforms.strength.value=o.glow*.2;this.post.uniformsNeedUpdate=true;this.renderer.setRenderTarget(null);this.renderer.render(this.postScene,this.postCamera);
    }
  }
  png(){return this.renderer.domElement.toDataURL('image/png');}
  private clearModels(){for(const m of this.models){m.material.dispose();if(m.points){m.points.geometry.dispose();(m.points.material as THREE.Material).dispose();}if(m.shadow){m.shadow.geometry.dispose();(m.shadow.material as THREE.Material).dispose();}m.light.shadow.map?.dispose();m.release();}this.models=[];}
  dispose(){this.disposed=true;this.clearModels();this.cache.dispose();this.env.dispose();this.hdrs.forEach(t=>t.dispose());this.target.dispose();this.blur.dispose();this.post.dispose();this.postMesh.geometry.dispose();this.renderer.dispose();this.renderer.forceContextLoss();}
}
