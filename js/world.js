// Scene construction: sky, lighting, terrain, road surface and scenery.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { buildArena, heightAt as arenaHeight, onPad } from './arena.js';

const TIMES = {
  day: { elevation: 38, azimuth: 150, exposure: 0.5, turbidity: 6, rayleigh: 1.4, sun: 2.8, hemi: 0.9, fog: 0xbcd0e0 },
  sunset: { elevation: 3.5, azimuth: 240, exposure: 0.42, turbidity: 9, rayleigh: 2.8, sun: 2.2, hemi: 0.55, fog: 0xe0a77d },
  night: { elevation: -8, azimuth: 200, exposure: 0.5, turbidity: 2, rayleigh: 0.4, sun: 0.0, hemi: 0.3, fog: 0x0a0f1a },
};

const THEMES = {
  desert: { ground: [196, 160, 118], groundVar: 26, offGrip: 0.6, offRoll: 3.5, name: 'Desert Dragway' },
  salt: { ground: [232, 230, 224], groundVar: 14, offGrip: 0.85, offRoll: 1.5, name: 'Salt Flats' },
  coast: { ground: [86, 122, 62], groundVar: 30, offGrip: 0.55, offRoll: 4.5, name: 'Island Coast Circuit' },
  arena: { ground: [184, 160, 124], groundVar: 24, offGrip: 0.8, offRoll: 2.5, name: 'Proving Ground' },
};

function canvasTexture(size, draw, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function noiseFill(ctx, size, [r, g, b], variance, speckle = 0) {
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const n = (Math.random() - 0.5) * variance;
    const sp = speckle && Math.random() < speckle ? 40 : 0;
    img.data[i * 4] = r + n + sp;
    img.data[i * 4 + 1] = g + n + sp;
    img.data[i * 4 + 2] = b + n + sp;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Quad strip between two lateral offsets (a > b, i.e. a is further left).
 * filter(i) can skip segments for dashed lines; color(i) gives vertex colors.
 */
function ribbon(track, a, b, y, { filter, uvLen = 12, color, uvWidth = 1 } = {}) {
  const pos = [];
  const uv = [];
  const col = [];
  const idx = [];
  const segs = track.closed ? track.n : track.n - 1;
  for (let i = 0; i < segs; i++) {
    if (filter && !filter(i)) continue;
    const j = track.idx(i + 1);
    const si = track.s[i];
    const sj = j === 0 ? track.length : track.s[j];
    const base = pos.length / 3;
    for (const [k, off] of [
      [i, a],
      [i, b],
      [j, a],
      [j, b],
    ]) {
      const lx = track.tz[k];
      const lz = -track.tx[k];
      pos.push(track.x[k] + lx * off, y, track.z[k] + lz * off);
    }
    uv.push(0, si / uvLen, uvWidth, si / uvLen, 0, sj / uvLen, uvWidth, sj / uvLen);
    if (color) {
      const c = color(i);
      for (let q = 0; q < 4; q++) col.push(c.r, c.g, c.b);
    }
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (color) geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function wall(track, offset, h0, h1, { filter } = {}) {
  const pos = [];
  const idx = [];
  const segs = track.closed ? track.n : track.n - 1;
  for (let i = 0; i < segs; i++) {
    if (filter && !filter(i)) continue;
    const j = track.idx(i + 1);
    const base = pos.length / 3;
    for (const k of [i, j]) {
      const lx = track.tz[k];
      const lz = -track.tx[k];
      const x = track.x[k] + lx * offset;
      const z = track.z[k] + lz * offset;
      pos.push(x, h0, z, x, h1, z);
    }
    idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function mulberry(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class World {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = null;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envTarget = null;
  }

  dispose() {
    if (!this.scene) return;
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) {
        for (const key of ['map', 'emissiveMap']) m[key]?.dispose?.();
        m.dispose();
      }
    });
    this.envTarget?.dispose();
    this.scene = null;
  }

  /**
   * @param {{track, theme:'desert'|'salt'|'coast', time:'day'|'sunset'|'night', wallOffset:number, decor:string, startS:number}} opts
   */
  build(opts) {
    this.dispose();
    const { track, theme, time } = opts;
    this.track = track;
    this.theme = THEMES[theme];
    this.time = TIMES[time];
    this.timeKey = time;
    this.wallOffset = opts.wallOffset;
    this.hasWalls = opts.hasWalls !== false;
    const scene = (this.scene = new THREE.Scene());
    this.renderer.toneMappingExposure = this.time.exposure;
    this.rand = mulberry(1234);

    this.buildSky();
    this.buildLights();
    this.buildGround(theme);
    this.buildRoad(opts);
    if (opts.decor === 'drag') this.buildDragDecor(opts);
    if (opts.decor === 'salt') this.buildSaltDecor(opts);
    if (opts.decor === 'coast') this.buildCoastDecor(opts);
    this.arena = opts.decor === 'arena' ? buildArena(this) : null;
    if (this.arena) this.mountains(70, 3000, 7000, { color: 0x9b7b5c, hMin: 120, hMax: 500 });
    scene.fog = new THREE.Fog(this.time.fog, 300, theme === 'coast' ? 5200 : 7000);
    return scene;
  }

  /** Drivable surface height: ramps, platforms and the like in the arena, flat elsewhere. */
  heightAt(x, z) {
    return this.arena ? arenaHeight(x, z) : 0;
  }

  get rails() {
    return this.arena?.rails ?? [];
  }

  /** Per-frame animation (the arena's rocket launch). Returns rumble 0..1. */
  update(dt, fx, camPos) {
    return this.arena ? this.arena.update(dt, fx, camPos) : 0;
  }

  surfaceAt(lateral, x, z) {
    if (this.arena && onPad(x, z)) return { grip: 1, rolling: 1, onRoad: true };
    if (Math.abs(lateral) <= this.track.width / 2 + 0.6) return { grip: 1, rolling: 1, onRoad: true };
    return { grip: this.theme.offGrip, rolling: this.theme.offRoll, onRoad: false };
  }

  buildSky() {
    const t = this.time;
    const sky = new Sky();
    sky.scale.setScalar(20000);
    const u = sky.material.uniforms;
    u.turbidity.value = t.turbidity;
    u.rayleigh.value = t.rayleigh;
    u.mieCoefficient.value = 0.005;
    u.mieDirectionalG.value = 0.8;
    const phi = THREE.MathUtils.degToRad(90 - t.elevation);
    const theta = THREE.MathUtils.degToRad(t.azimuth);
    this.sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(this.sunDir);
    this.scene.add(sky);

    // Environment reflections from the same sky.
    const envScene = new THREE.Scene();
    const envSky = new Sky();
    envSky.scale.setScalar(1000);
    for (const k of Object.keys(u)) envSky.material.uniforms[k].value = u[k].value;
    envScene.add(envSky);
    if (this.timeKey === 'night') {
      envScene.add(new THREE.HemisphereLight(0x334466, 0x000000, 1));
      envScene.background = new THREE.Color(0x05070c);
    }
    this.envTarget = this.pmrem.fromScene(envScene, 0.02);
    this.scene.environment = this.envTarget.texture;
    envSky.material.dispose();
    envSky.geometry.dispose();

    if (this.timeKey === 'night') {
      const n = 2500;
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const v = new THREE.Vector3().setFromSphericalCoords(9000, Math.acos(this.rand() * 0.95), this.rand() * Math.PI * 2);
        pos.set([v.x, v.y, v.z], i * 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const stars = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 14, sizeAttenuation: true, fog: false }));
      this.scene.add(stars);
      const moon = new THREE.Mesh(new THREE.SphereGeometry(160, 24, 16), new THREE.MeshBasicMaterial({ color: 0xf4f1e6, fog: false }));
      moon.position.set(-4000, 2600, -6000);
      this.scene.add(moon);
    }
  }

  buildLights() {
    const t = this.time;
    const night = this.timeKey === 'night';
    const hemi = new THREE.HemisphereLight(night ? 0x6b7fa8 : 0xcfe3ff, night ? 0x10131a : 0x8a7a5a, t.hemi);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(night ? 0x9fb4ff : this.timeKey === 'sunset' ? 0xffb37a : 0xfff4e5, night ? 0.5 : t.sun);
    const dir = night ? new THREE.Vector3(-0.5, 0.6, -0.6).normalize() : this.sunDir.clone();
    dir.y = Math.max(dir.y, 0.12);
    this.sunOffset = dir.normalize().multiplyScalar(120);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -45;
    sc.right = sc.top = 45;
    sc.near = 10;
    sc.far = 300;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun, sun.target);
    this.sun = sun;
  }

  /** Keep the shadow frustum centered on the car. */
  follow(x, z) {
    this.sun.target.position.set(x, 0, z);
    this.sun.position.set(x + this.sunOffset.x, this.sunOffset.y, z + this.sunOffset.z);
  }

  buildGround(theme) {
    const th = this.theme;
    const tex = canvasTexture(256, (ctx, s) => noiseFill(ctx, s, th.ground, th.groundVar, theme === 'coast' ? 0 : 0.01), 1);
    tex.repeat.set(900, 900);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: theme === 'salt' ? 0.75 : 0.95 });
    let geo;
    if (theme === 'coast') geo = new THREE.CircleGeometry(1750, 128, 0, Math.PI * 2);
    // Subdivided: two giant triangles lose depth precision and swallow the road on some GPUs.
    else geo = new THREE.PlaneGeometry(30000, 30000, 120, 120);
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.12; // well below the road so low-precision depth buffers don't z-fight
    ground.receiveShadow = true;
    this.scene.add(ground);
    if (theme === 'coast') tex.repeat.set(110, 110);
  }

  buildRoad({ track, decor, wallOffset }) {
    const w = track.width / 2;
    const asphalt = canvasTexture(256, (ctx, s) => {
      noiseFill(ctx, s, [58, 60, 64], 22, 0.004);
      // subtle tyre-worn lanes
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(s * 0.18, 0, s * 0.14, s);
      ctx.fillRect(s * 0.68, 0, s * 0.14, s);
    });
    asphalt.repeat.set(1, 1);
    const roadMat = new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.82, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const road = new THREE.Mesh(ribbon(track, w, -w, 0.0, { uvLen: track.width }), roadMat);
    road.receiveShadow = true;
    this.scene.add(road);

    const lineMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
    const yellow = new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
    const lines = new THREE.Group();
    lines.add(new THREE.Mesh(ribbon(track, w - 0.3, w - 0.5, 0.01), lineMat));
    lines.add(new THREE.Mesh(ribbon(track, -w + 0.5, -w + 0.3, 0.01), lineMat));
    const dash = (i) => Math.floor(track.s[i] / 6) % 2 === 0;
    if (decor === 'drag') {
      lines.add(new THREE.Mesh(ribbon(track, 0.12, -0.12, 0.01), yellow));
    } else if (decor === 'coast') {
      lines.add(new THREE.Mesh(ribbon(track, 0.12, -0.12, 0.01, { filter: dash }), lineMat));
    } else {
      // Salt flats: painted lane every 10 m
      for (const o of [-6, 6]) lines.add(new THREE.Mesh(ribbon(track, o + 0.15, o - 0.15, 0.01, { filter: dash }), lineMat));
    }
    lines.traverse((o) => (o.receiveShadow = true));
    this.scene.add(lines);

    if (decor === 'coast') {
      // Red/white kerbs on corners
      const red = new THREE.Color(0xc4161c);
      const white = new THREE.Color(0xf4f4f4);
      const kerbMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
      const onCorner = (i) => Math.abs(track.curv[i]) > 1 / 480;
      const color = (i) => (Math.floor(track.s[i] / 3) % 2 ? red : white);
      this.scene.add(new THREE.Mesh(ribbon(track, w + 1.2, w, 0.02, { filter: onCorner, color }), kerbMat));
      this.scene.add(new THREE.Mesh(ribbon(track, -w, -w - 1.2, 0.02, { filter: onCorner, color }), kerbMat));
    }

    if (this.hasWalls) {
      const isDrag = decor === 'drag';
      const wallMat = new THREE.MeshStandardMaterial({
        color: isDrag ? 0xd9d6cf : 0xb8bec6,
        roughness: isDrag ? 0.9 : 0.35,
        metalness: isDrag ? 0 : 0.7,
        side: THREE.DoubleSide,
      });
      const h = isDrag ? 1.0 : 0.8;
      for (const side of [1, -1]) {
        const m = new THREE.Mesh(wall(track, side * wallOffset, isDrag ? 0 : 0.35, h), wallMat);
        m.castShadow = true;
        m.receiveShadow = true;
        this.scene.add(m);
        if (!isDrag) {
          // guardrail posts
          const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.8, 0.12), wallMat, Math.ceil(track.length / 4));
          let c = 0;
          const mtx = new THREE.Matrix4();
          for (let s = 0; s < track.length; s += 4) {
            const p = track.sample(s, side * (wallOffset + 0.1));
            mtx.makeTranslation(p.x, 0.4, p.z);
            posts.setMatrixAt(c++, mtx);
          }
          posts.count = c;
          this.scene.add(posts);
        }
      }
    }
  }

  crossLine(s, color = 0xffffff, width = this.track.width, depth = 0.6, y = 0.015) {
    const p = this.track.sample(s);
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth),
      new THREE.MeshStandardMaterial({ color, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -3 }),
    );
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = p.heading;
    m.position.set(p.x, y, p.z);
    m.receiveShadow = true;
    this.scene.add(m);
    return m;
  }

  sign(text, s, lateral, { w = 6, h = 2.2, y = 3.5, bg = '#111', fg = '#fff', face = 0 } = {}) {
    const p = this.track.sample(s, lateral);
    const cw = 512;
    const ch = Math.max(32, Math.round((cw * h) / w));
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    const ctx = c.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = fg;
    let font = ch * 0.62;
    ctx.font = `700 ${font}px system-ui, sans-serif`;
    const tw = ctx.measureText(text).width;
    if (tw > cw * 0.88) font *= (cw * 0.88) / tw;
    ctx.font = `700 ${font}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cw / 2, ch / 2 + font * 0.04);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: this.timeKey === 'night' ? 0.6 : 0.05 }));
    board.position.set(p.x, y, p.z);
    board.rotation.y = p.heading + face;
    this.scene.add(board);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.6, roughness: 0.4 });
    for (const dx of [-w / 2 + 0.2, w / 2 - 0.2]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.15, y, 0.15), postMat);
      const q = this.track.sample(s, lateral + dx * Math.cos(face));
      post.position.set(q.x, y / 2 - h / 2, q.z);
      post.castShadow = true;
      this.scene.add(post);
    }
    return board;
  }

  lightPoles(spacing, lateral, from, to) {
    const night = this.timeKey === 'night';
    const n = Math.ceil((to - from) / spacing) * 2;
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x6b6f75, metalness: 0.6, roughness: 0.4 });
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe2b0, emissiveIntensity: night ? 3 : 0.2 });
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.14, 10, 8), poleMat, n);
    const lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 0.2, 0.5), lampMat, n);
    let c = 0;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let s = from; s < to; s += spacing) {
      for (const side of [1, -1]) {
        const p = this.track.sample(s, side * lateral);
        m.makeTranslation(p.x, 5, p.z);
        poles.setMatrixAt(c, m);
        const l = this.track.sample(s, side * (lateral - 0.9));
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.heading);
        m.compose(new THREE.Vector3(l.x, 10, l.z), q, new THREE.Vector3(1, 1, 1));
        lamps.setMatrixAt(c, m);
        c++;
      }
    }
    poles.count = lamps.count = c;
    poles.castShadow = true;
    this.scene.add(poles, lamps);
  }

  mountains(count, rMin, rMax, { arc = [0, Math.PI * 2], color = 0x8a7865, hMin = 150, hMax = 600, center = [0, 0] } = {}) {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true });
    const geo = new THREE.ConeGeometry(1, 1, 7, 3);
    // jitter vertices for a rocky look
    const pa = geo.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      if (pa.getY(i) < 0.49) {
        pa.setX(i, pa.getX(i) * (0.8 + this.rand() * 0.4));
        pa.setZ(i, pa.getZ(i) * (0.8 + this.rand() * 0.4));
      }
    }
    geo.computeVertexNormals();
    const inst = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const a = arc[0] + this.rand() * (arc[1] - arc[0]);
      const r = rMin + this.rand() * (rMax - rMin);
      const h = hMin + this.rand() * (hMax - hMin);
      const wdt = h * (0.8 + this.rand() * 0.8);
      m.compose(
        new THREE.Vector3(center[0] + Math.cos(a) * r, h / 2 - 5, center[1] + Math.sin(a) * r),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.rand() * 6),
        new THREE.Vector3(wdt, h, wdt),
      );
      inst.setMatrixAt(i, m);
    }
    this.scene.add(inst);
  }

  // ---------- Drag strip ----------
  buildDragDecor({ startS, finishS }) {
    const track = this.track;
    this.crossLine(startS, 0xffffff, track.width, 0.4);
    this.crossLine(startS + 201.168, 0xffffff, track.width, 0.3);
    this.crossLine(finishS, 0xffffff, track.width, 0.8);
    // Checkered finish
    const check = canvasTexture(64, (ctx, s) => {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        ctx.fillStyle = (x + y) % 2 ? '#111' : '#fff';
        ctx.fillRect((x * s) / 8, (y * s) / 8, s / 8, s / 8);
      }
    });
    check.repeat.set(4, 1);
    const fin = this.crossLine(finishS + 1.2, 0xffffff, track.width, 1.6);
    fin.material.map = check;

    // Burnout box / starting area darker rubber
    const rubber = new THREE.Mesh(new THREE.PlaneGeometry(track.width, 60), new THREE.MeshStandardMaterial({ color: 0x1d1e20, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -1 }));
    rubber.rotation.x = -Math.PI / 2;
    rubber.position.set(0, 0.005, -25);
    rubber.receiveShadow = true;
    this.scene.add(rubber);

    // Distance boards
    this.sign('60 FT', startS + 18.29, 11, { w: 3, h: 1.2, y: 2 });
    this.sign('330 FT', startS + 100.58, 11, { w: 3.4, h: 1.2, y: 2 });
    this.sign('1/8 MILE', startS + 201.168, 11.5, { w: 4.2, h: 1.4, y: 2.5 });
    this.sign('1000 FT', startS + 304.8, 11, { w: 3.6, h: 1.2, y: 2 });
    this.sign('1/4 MILE', finishS, 12, { w: 5, h: 1.8, y: 3 });
    this.sign('SHUTDOWN', finishS + 250, 12, { w: 5, h: 1.6, y: 3, bg: '#7a1010' });

    // Finish gantry
    const gantryMat = new THREE.MeshStandardMaterial({ color: 0x222428, metalness: 0.7, roughness: 0.35 });
    const fp = track.sample(finishS);
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.4, 7, 0.4), gantryMat);
      leg.position.set(fp.x + side * 9.6, 3.5, fp.z);
      leg.castShadow = true;
      this.scene.add(leg);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(19.6, 1.2, 0.5), gantryMat);
    beam.position.set(fp.x, 7, fp.z);
    beam.castShadow = true;
    this.scene.add(beam);

    // Grandstands near the start, both sides
    const standMat = new THREE.MeshStandardMaterial({ color: 0x8b9099, roughness: 0.8 });
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x2c5aa0, roughness: 0.7 });
    for (const side of [-1, 1]) {
      for (let k = 0; k < 6; k++) {
        const step = new THREE.Mesh(new THREE.BoxGeometry(2, 0.6 + k * 0.6, 110), k % 2 ? standMat : seatMat);
        step.position.set(side * (20 + k * 2), (0.6 + k * 0.6) / 2, -45);
        step.castShadow = true;
        step.receiveShadow = true;
        this.scene.add(step);
      }
    }
    // Tower
    const tower = new THREE.Mesh(new THREE.BoxGeometry(6, 14, 6), new THREE.MeshStandardMaterial({ color: 0xe5e1d8, roughness: 0.8 }));
    tower.position.set(-34, 7, 20);
    tower.castShadow = true;
    this.scene.add(tower);
    const towerGlass = new THREE.Mesh(new THREE.BoxGeometry(6.2, 2.5, 6.2), new THREE.MeshStandardMaterial({ color: 0x1a2a3a, metalness: 0.8, roughness: 0.1 }));
    towerGlass.position.set(-34, 12.5, 20);
    this.scene.add(towerGlass);

    this.buildChristmasTree(startS);
    this.lightPoles(50, 10.5, 0, track.length);

    // Sand trap + catch net at the end
    const endP = track.sample(track.length);
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(track.width + 6, 120), new THREE.MeshStandardMaterial({ color: 0xcaa774, roughness: 1 }));
    sand.rotation.x = -Math.PI / 2;
    sand.position.set(endP.x, 0.01, endP.z + 60);
    this.scene.add(sand);
    this.endBarrier(track.length);

    this.mountains(60, 3500, 7000, { color: 0x9b7b5c });
  }

  endBarrier(s) {
    const p = this.track.sample(s);
    const tex = canvasTexture(128, (ctx, size) => {
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = i % 2 ? '#d42020' : '#f2f2f2';
        ctx.fillRect((i * size) / 8, 0, size / 8, size);
      }
    });
    tex.repeat.set(4, 1);
    const b = new THREE.Mesh(new THREE.BoxGeometry(this.track.width + 4, 1.4, 1.2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }));
    b.position.set(p.x, 0.7, p.z - 1);
    b.rotation.y = p.heading;
    b.castShadow = true;
    this.scene.add(b);
  }

  buildChristmasTree(startS) {
    const p = this.track.sample(startS + 6, 0);
    const tree = new THREE.Group();
    tree.position.set(p.x, 0, p.z);
    tree.rotation.y = p.heading;
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.4, 0.3), new THREE.MeshStandardMaterial({ color: 0x1b1b1b }));
    pole.position.y = 1.7;
    tree.add(pole);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.6, 2.2, 0.35), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5 }));
    housing.position.y = 2.6;
    tree.add(housing);
    const bulbs = {};
    const defs = [
      ['prestage', 3.55, 0xfff4c0],
      ['stage', 3.35, 0xfff4c0],
      ['amber1', 3.0, 0xffa000],
      ['amber2', 2.65, 0xffa000],
      ['amber3', 2.3, 0xffa000],
      ['green', 1.95, 0x18ff40],
      ['red', 1.6, 0xff1515],
    ];
    for (const [key, y, color] of defs) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: color, emissiveIntensity: 0 });
      // Lights face the car (behind the tree, +Z side in the tree's frame).
      for (const dx of [-0.15, 0.15]) {
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), mat);
        bulb.position.set(dx, y, 0.18);
        tree.add(bulb);
      }
      bulbs[key] = mat;
    }
    this.scene.add(tree);
    this.treeBulbs = bulbs;
  }

  setTree(state) {
    if (!this.treeBulbs) return;
    for (const [k, mat] of Object.entries(this.treeBulbs)) mat.emissiveIntensity = state[k] ? 1.6 : 0;
  }

  // ---------- Salt flats ----------
  buildSaltDecor({ startS }) {
    const track = this.track;
    this.crossLine(startS, 0x111111, 30, 0.5);
    // Cone lines marking the course
    const coneGeo = new THREE.ConeGeometry(0.25, 0.7, 12);
    const coneMat = new THREE.MeshStandardMaterial({ color: 0xff5a1a, roughness: 0.6 });
    const count = Math.ceil(track.length / 25) * 2;
    const cones = new THREE.InstancedMesh(coneGeo, coneMat, count);
    const m = new THREE.Matrix4();
    let c = 0;
    for (let s = 0; s < track.length; s += 25) {
      for (const side of [-1, 1]) {
        const p = track.sample(s, side * (track.width / 2 + 1));
        m.makeTranslation(p.x, 0.35, p.z);
        cones.setMatrixAt(c++, m);
      }
    }
    cones.count = c;
    cones.castShadow = true;
    this.scene.add(cones);
    // Mile markers
    for (let mi = 1; mi * 1609.344 + startS < track.length - 100; mi++) {
      this.sign(`MILE ${mi}`, startS + mi * 1609.344, 20, { w: 5, h: 1.6, y: 2.5, bg: '#1d3f8a' });
    }
    this.sign('START', startS, -20, { w: 5, h: 1.6, y: 2.5 });
    this.sign('BRAKE ZONE', track.length - 900, 20, { w: 6, h: 1.6, y: 2.5, bg: '#9a1414' });
    this.endBarrier(track.length);
    this.mountains(80, 5000, 9000, { color: 0x7d6c63, hMin: 300, hMax: 900 });
    // Support crew tents near start
    const tentMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.8 });
    for (let k = 0; k < 4; k++) {
      const tent = new THREE.Mesh(new THREE.ConeGeometry(3.5, 3, 4), tentMat);
      tent.position.set(-28 - k * 9, 1.5, 30 + (k % 2) * 6);
      tent.rotation.y = Math.PI / 4;
      tent.castShadow = true;
      this.scene.add(tent);
    }
  }

  // ---------- Coastal circuit ----------
  buildCoastDecor({ startS = 0 }) {
    const track = this.track;
    // Ocean
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(40000, 40000),
      new THREE.MeshStandardMaterial({ color: this.timeKey === 'night' ? 0x061424 : 0x1a5a85, roughness: 0.12, metalness: 0.3 }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = -0.6;
    this.scene.add(water);
    this.water = water;
    const beach = new THREE.Mesh(new THREE.RingGeometry(1745, 1830, 128), new THREE.MeshStandardMaterial({ color: 0xdcc9a0, roughness: 1 }));
    beach.rotation.x = -Math.PI / 2;
    beach.position.y = -0.3;
    this.scene.add(beach);

    // Start/finish
    this.crossLine(startS, 0xffffff, track.width, 0.8);
    const gp = track.sample(startS);
    const gantryMat = new THREE.MeshStandardMaterial({ color: 0x1b1d22, metalness: 0.6, roughness: 0.4 });
    for (const side of [-1, 1]) {
      const p = track.sample(startS, side * (track.width / 2 + 2));
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.6, 8, 0.6), gantryMat);
      leg.position.set(p.x, 4, p.z);
      leg.castShadow = true;
      this.scene.add(leg);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(track.width + 4.6, 1.6, 0.6), gantryMat);
    beam.position.set(gp.x, 8, gp.z);
    beam.rotation.y = gp.heading;
    beam.castShadow = true;
    this.scene.add(beam);
    this.sign('START / FINISH', startS - 0.5, 0, { w: track.width + 2, h: 1.4, y: 8, bg: '#0e0f12' });

    // Pit building
    const pit = new THREE.Mesh(new THREE.BoxGeometry(8, 6, 120), new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.6 }));
    const pp = track.sample(startS + 40, -(this.wallOffset + 12));
    pit.position.set(pp.x, 3, pp.z);
    pit.rotation.y = pp.heading;
    pit.castShadow = true;
    this.scene.add(pit);

    // Corner distance boards before tight corners
    let last = -1000;
    for (let i = 0; i < track.n; i++) {
      if (Math.abs(track.curv[i]) > 1 / 420 && track.s[i] - last > 600) {
        last = track.s[i];
        const outside = track.curv[i] > 0 ? -1 : 1;
        for (const [d, label] of [[150, '150'], [100, '100'], [50, '50']]) {
          this.sign(label, track.s[i] - d - 40, outside * (this.wallOffset + 3), { w: 1.6, h: 1.2, y: 1.3, bg: '#f5f5f5', fg: '#111' });
        }
      }
    }

    // Trees
    const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 3, 6);
    const leafGeo = new THREE.ConeGeometry(2.4, 7, 8);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 1 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f5a2a, roughness: 0.95, flatShading: true });
    const N = 2600;
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, N);
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, N);
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    let c = 0;
    let hint = 0;
    for (let tries = 0; tries < N * 3 && c < N; tries++) {
      const s = this.rand() * track.length;
      const side = this.rand() < 0.5 ? -1 : 1;
      const off = this.wallOffset + 6 + Math.pow(this.rand(), 1.6) * 260;
      const p = track.sample(s, side * off);
      if (Math.hypot(p.x, p.z) > 1700) continue;
      const near = track.nearest(p.x, p.z, hint);
      hint = near.i;
      if (Math.abs(near.lateral) < this.wallOffset + 5) continue;
      const sc = 0.7 + this.rand() * 0.9;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.rand() * 6);
      m.compose(new THREE.Vector3(p.x, 1.5 * sc, p.z), q, new THREE.Vector3(sc, sc, sc));
      trunks.setMatrixAt(c, m);
      m.compose(new THREE.Vector3(p.x, (3 + 3.5) * sc, p.z), q, new THREE.Vector3(sc, sc, sc));
      leaves.setMatrixAt(c, m);
      col.setHSL(0.27 + this.rand() * 0.08, 0.45, 0.22 + this.rand() * 0.12);
      leaves.setColorAt(c, col);
      c++;
    }
    trunks.count = leaves.count = c;
    leaves.castShadow = true;
    this.scene.add(trunks, leaves);

    // Mountains on the northern arc of the island and distant islands
    this.mountains(26, 2300, 3000, { arc: [Math.PI * 0.15, Math.PI * 0.85], color: 0x6f7d5a, hMin: 120, hMax: 420 });
    this.mountains(40, 5000, 9000, { color: 0x5d6b78, hMin: 200, hMax: 800 });
    if (this.timeKey === 'night') this.lightPoles(80, this.wallOffset + 1.5, 0, track.length);
  }
}
