// Camera rig: chase, hood, cockpit, and trackside TV views.
import * as THREE from 'three';

export const CAMERA_MODES = ['chase', 'cockpit', 'hood', 'tv'];
const LABELS = { chase: 'Chase cam', cockpit: 'Driver seat', hood: 'Hood cam', tv: 'Trackside TV' };

export class CameraRig {
  constructor(aspect) {
    this.camera = new THREE.PerspectiveCamera(62, aspect, 0.1, 30000);
    this.mode = 'chase';
    this.pos = new THREE.Vector3(0, 3, 8);
    this.look = new THREE.Vector3();
    this.tvSpot = null;
    this.shake = 0;
    this.orbit = 0;
  }

  get label() {
    return LABELS[this.mode];
  }

  cycle() {
    const i = CAMERA_MODES.indexOf(this.mode);
    this.mode = CAMERA_MODES[(i + 1) % CAMERA_MODES.length];
    this.snap = true;
    this.tvSpot = null;
    return this.mode;
  }

  set(mode) {
    this.mode = mode;
    this.snap = true;
    this.tvSpot = null;
  }

  bump(amount) {
    this.shake = Math.min(1, this.shake + amount);
  }

  /**
   * @param {number} dt
   * @param {THREE.Object3D} car the car's root object (yaw only)
   * @param {THREE.Object3D} body the sprung body
   * @param {{v:number, longAcc:number}} phys
   * @param {import('./track.js').Track} track
   * @param {number} trackS
   */
  update(dt, car, body, phys, track, trackS, { attract = false } = {}) {
    const cam = this.camera;
    const v = Math.abs(phys.v);
    const speedK = Math.min(1, v / 110);
    let fov = 62;
    const tmp = new THREE.Vector3();

    if (attract) {
      // Slow orbit around the car for the menu background.
      this.orbit += dt * 0.12;
      const r = 8.5;
      tmp.set(Math.sin(this.orbit) * r, 2.2 + Math.sin(this.orbit * 0.7) * 0.6, Math.cos(this.orbit) * r);
      car.localToWorld(tmp);
      this.pos.lerp(tmp, this.snap ? 1 : 1 - Math.exp(-dt * 3));
      this.look.copy(car.position).add(new THREE.Vector3(0, 0.8, 0));
      fov = 45;
    } else if (this.mode === 'chase') {
      const back = 6.4 + speedK * 1.4 - Math.max(-0.6, Math.min(0.8, phys.longAcc / 18));
      tmp.set(0, 1.9 + speedK * 0.2, back);
      car.localToWorld(tmp);
      if (this.pos.distanceTo(tmp) > 60) this.snap = true; // restarts, long frame hitches
      const k = this.snap ? 1 : 1 - Math.exp(-dt * 7);
      this.pos.lerp(tmp, k);
      const lookTarget = new THREE.Vector3(0, 0.9, -3);
      car.localToWorld(lookTarget);
      this.look.lerp(lookTarget, this.snap ? 1 : 1 - Math.exp(-dt * 12));
      fov = 60 + speedK * 20;
    } else if (this.mode === 'hood' || this.mode === 'cockpit') {
      const local = this.mode === 'hood' ? new THREE.Vector3(0, 1.22, -1.3) : new THREE.Vector3(-0.38, 1.4, 0.1);
      body.localToWorld(this.pos.copy(local));
      const ahead = this.mode === 'hood' ? new THREE.Vector3(0, 1.0, -30) : new THREE.Vector3(-0.38, 1.0, -30);
      body.localToWorld(this.look.copy(ahead));
      fov = (this.mode === 'hood' ? 68 : 72) + speedK * 14;
    } else {
      // Trackside: pick a camera spot ahead of the car; switch when it passes.
      if (!this.tvSpot || this.tvSpot.passedAt <= trackS - 25 || this.tvSpot.s - trackS > 400) {
        const s = trackS + 120 + v * 1.5;
        const side = Math.random() < 0.5 ? -1 : 1;
        const p = track.sample(s, side * (track.width / 2 + 14));
        this.tvSpot = { s, passedAt: s, pos: new THREE.Vector3(p.x, 3 + Math.random() * 5, p.z) };
      }
      this.pos.copy(this.tvSpot.pos);
      this.look.copy(car.position).add(new THREE.Vector3(0, 0.7, 0));
      const d = this.pos.distanceTo(this.look);
      fov = THREE.MathUtils.clamp(2400 / Math.max(d, 1), 10, 60);
    }

    cam.position.copy(this.pos);
    // High-speed vibration and impact shake
    const buzz = this.mode === 'tv' ? 0 : speedK * speedK * 0.012 + this.shake * 0.12;
    if (buzz > 0) {
      cam.position.x += (Math.random() - 0.5) * buzz;
      cam.position.y += (Math.random() - 0.5) * buzz;
    }
    this.shake = Math.max(0, this.shake - dt * 2.5);
    cam.lookAt(this.look);
    // On the menu, push the car into the open right-hand side of the screen.
    const w = innerWidth;
    const h = innerHeight;
    if (attract && w > 760) cam.setViewOffset(w, h, -w * 0.22, 0, w, h);
    else if (cam.view?.enabled) cam.clearViewOffset();
    // Three.js FOV is vertical. On portrait screens, widen it so the horizontal
    // view matches a landscape screen instead of zooming into the car.
    const aspect = w / h;
    if (aspect < 1.3) {
      const hf = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov) / 2) * 1.3);
      fov = Math.min(105, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hf / 2) / aspect)));
    }
    cam.fov += (fov - cam.fov) * (this.snap ? 1 : 1 - Math.exp(-dt * 4));
    cam.updateProjectionMatrix();
    this.snap = false;
  }
}
