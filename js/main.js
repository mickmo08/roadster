import * as THREE from 'three';
import { CarPhysics, SPEC, TRIMS } from './car.js';
import { buildRoadster, PAINTS } from './roadsterModel.js';
import { World } from './world.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { Hud } from './hud.js';
import { CameraRig } from './camera.js';
import { Autopilot } from './autopilot.js';
import { Effects } from './fx.js';
import { MODE_LIST, ShowroomMode, blockAt } from './modes.js';
import { loadSettings, saveSettings, Bests } from './storage.js';
import { fmtLap, fmtSec, fmtSpeed } from './format.js';

const PHYS_DT = 1 / 120;
const $ = (id) => document.getElementById(id);
const tmpV = new THREE.Vector3();
const tmpD = new THREE.Vector3();

const CRASH_LINES = {
  roof: 'Landed on the roof',
  tumble: 'Landed sideways',
  hard: 'Landed too hard',
  side: 'Flew into the side of something',
  wall: 'Hit a wall',
};

class Game {
  constructor() {
    this.settings = loadSettings();
    this.best = new Bests();
    this.state = 'loading'; // attract | running | paused | results

    const canvas = $('scene');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = this.settings.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.world = new World(this.renderer);
    this.rig = new CameraRig(innerWidth / innerHeight);
    this.input = new Input();
    this.audio = new AudioEngine();
    this.audio.muted = !this.settings.sound;
    this.hud = new Hud();
    this.fx = new Effects();
    this.autopilot = new Autopilot();
    this.car = new CarPhysics(this.settings.trim);
    this.model = buildRoadster(this.settings.paint);
    this.model.setTrim(this.car.trim.key);
    this.chaseFrame = new THREE.Object3D();
    this.chaseYaw = 0;
    this.hint = -1;
    this.acc = 0;
    this.last = performance.now();
    this.controls = { throttle: 0, brake: 0, steer: 0, boost: false, lift: false, roll: 0 };
    this.ground = (x, z) => this.world.heightAt(x, z);

    this.input.onAction = (a) => this.onAction(a);
    this.input.bindTouch($('touch'));
    addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'running') this.pause(true);
    });
    this.resize();
    this.bindUi();

    this.loadMode(new ShowroomMode(this), { attract: true });
    this.state = 'attract';
    document.body.classList.remove('loading');
    requestAnimationFrame((t) => this.frame(t));
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.rig.camera.aspect = innerWidth / innerHeight;
    this.rig.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ UI
  bindUi() {
    const s = this.settings;
    const cards = $('modes');
    for (const m of MODE_LIST) {
      const b = document.createElement('button');
      b.className = 'mode-card';
      b.dataset.mode = m.id;
      b.innerHTML = `<span class="tag"></span><strong></strong><p></p><em class="pb"></em>`;
      b.querySelector('.tag').textContent = m.tag;
      b.querySelector('strong').textContent = m.title;
      b.querySelector('p').textContent = m.desc;
      b.addEventListener('click', () => this.startMode(m.id));
      cards.append(b);
    }
    this.refreshBests();

    const trims = $('trims');
    for (const t of Object.values(TRIMS)) {
      const b = document.createElement('button');
      b.className = 'trim';
      b.dataset.v = t.key;
      b.innerHTML = `<strong></strong><span></span><em></em>`;
      b.querySelector('strong').textContent = t.name;
      b.querySelector('span').textContent = t.tagline;
      b.querySelector('em').textContent = `0–60 ${t.claim060}`;
      b.classList.toggle('on', t.key === s.trim);
      b.addEventListener('click', () => {
        s.trim = t.key;
        for (const o of trims.children) o.classList.toggle('on', o === b);
        this.applyTrim();
        this.saveSettings();
      });
      trims.append(b);
    }

    const paints = $('paints');
    for (const [key, p] of Object.entries(PAINTS)) {
      const sw = document.createElement('button');
      sw.className = 'swatch';
      sw.title = p.name;
      sw.setAttribute('aria-label', p.name);
      sw.style.setProperty('--c', `#${p.color.toString(16).padStart(6, '0')}`);
      sw.classList.toggle('on', key === s.paint);
      sw.addEventListener('click', () => {
        s.paint = key;
        this.model.setPaint(key);
        for (const o of paints.children) o.classList.toggle('on', o === sw);
        $('paint-name').textContent = p.name;
        this.saveSettings();
      });
      paints.append(sw);
    }
    $('paint-name').textContent = PAINTS[s.paint]?.name ?? '';

    const seg = (id, key, onChange) => {
      const root = $(id);
      for (const btn of root.querySelectorAll('button')) {
        btn.classList.toggle('on', btn.dataset.v === String(s[key]));
        btn.addEventListener('click', () => {
          s[key] = btn.dataset.v === 'true' ? true : btn.dataset.v === 'false' ? false : btn.dataset.v;
          for (const o of root.querySelectorAll('button')) o.classList.toggle('on', o === btn);
          this.saveSettings();
          onChange?.();
        });
      }
    };
    seg('opt-units', 'units', () => this.refreshBests());
    seg('opt-time', 'time', () => {
      if (this.state === 'attract') this.loadMode(new ShowroomMode(this), { attract: true });
    });
    seg('opt-sound', 'sound', () => this.audio.setMuted(!s.sound));
    seg('opt-shadows', 'shadows', () => {
      this.renderer.shadowMap.enabled = s.shadows;
      this.world.scene?.traverse((o) => o.material && (o.material.needsUpdate = true));
    });

    $('btn-camera').addEventListener('click', () => this.onAction('camera'));
    $('btn-pause').addEventListener('click', () => this.onAction('pause'));
    $('btn-ap').addEventListener('click', () => this.onAction('autopilot'));
    $('btn-reset').addEventListener('click', () => this.onAction('reset'));
    $('btn-resume').addEventListener('click', () => this.pause(false));
    $('btn-restart').addEventListener('click', () => this.restart());
    $('btn-quit').addEventListener('click', () => this.toMenu());
    $('btn-retry').addEventListener('click', () => this.restart());
    $('btn-menu').addEventListener('click', () => this.toMenu());
    $('btn-specs').addEventListener('click', () => ($('specs').hidden = false));
    $('btn-specs-close').addEventListener('click', () => ($('specs').hidden = true));
    $('btn-tilt').addEventListener('click', async () => {
      const ok = this.input.tilt.enabled ? ((this.input.tilt.enabled = false), false) : await this.input.enableTilt();
      $('btn-tilt').classList.toggle('on', ok);
      $('touch').classList.toggle('tilt', ok);
    });

    const touchy = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    document.body.classList.toggle('touch', touchy);
    this.applyTrim();
  }

  applyTrim() {
    this.car.setTrim(this.settings.trim);
    this.model.setTrim(this.car.trim.key);
    document.body.dataset.trim = this.car.trim.key;
    $('trim-blurb').textContent = {
      performance: 'Two seats. Active aero and the multi-mode suction-fan system, which holds the car to the road (or a ceiling) even when stopped.',
      thrust: 'Adds rear cold-gas thrusters fed from carbon-overwrapped pressure vessels. Hold Shift for a sub-second 0–60.',
      rocket: 'Single seat. Ten cold-gas thrusters around the car for lift and rotation. Not approved for public roads.',
    }[this.car.trim.key];
  }

  saveSettings() {
    saveSettings(this.settings);
  }

  refreshBests() {
    const u = this.settings.units;
    const b = this.best;
    const text = {
      stunt: b.get('stunt_score') ? `Best ${b.get('stunt_score').toLocaleString()} pts` : '',
      drag: b.get('drag_et') ? `PB ${fmtSec(b.get('drag_et'))}` : '',
      top: b.get('top_speed') ? `PB ${fmtSpeed(b.get('top_speed'), u)}` : '',
      circuit: b.get('circuit_lap') ? `PB ${fmtLap(b.get('circuit_lap'))}` : '',
      cruise: '',
    };
    for (const card of document.querySelectorAll('.mode-card')) card.querySelector('.pb').textContent = text[card.dataset.mode];
  }

  onAction(a) {
    if (a === 'mute') {
      this.settings.sound = !this.settings.sound;
      this.audio.setMuted(!this.settings.sound);
      this.hud.toast(this.settings.sound ? 'Sound on' : 'Sound off');
      this.saveSettings();
      return;
    }
    if (this.state === 'running') {
      if (a === 'camera') {
        this.rig.cycle();
        this.settings.camera = this.rig.mode;
        this.saveSettings();
        this.hud.toast(this.rig.label);
      } else if (a === 'pause') this.pause(true);
      else if (a === 'autopilot') {
        this.autopilot.enabled = !this.autopilot.enabled;
        this.hud.toast(this.autopilot.enabled ? 'Autopilot ride-along: on' : 'Autopilot: off. You have control');
      } else if (a === 'reverse') {
        const want = this.car.gear === 'R' ? 'D' : 'R';
        if (this.car.setGear(want)) this.hud.toast(want === 'R' ? 'Reverse' : 'Drive');
        else this.hud.toast('Stop to change gear');
      } else if (a === 'reset') {
        this.car.respawn();
        this.hud.toast('Car reset');
      }
    } else if (this.state === 'paused' && a === 'pause') this.pause(false);
    else if (this.state === 'results' && a === 'confirm') this.restart();
  }

  // ------------------------------------------------------------------ flow
  loadMode(mode, { attract = false } = {}) {
    this.mode = mode;
    const cfg = mode.config();
    this.cfg = cfg;
    this.track = cfg.track;
    const scene = this.world.build({ ...cfg, time: this.settings.time });
    this.scene = scene;
    this.fx.attach(scene);

    const night = this.settings.time === 'night';
    for (const b of this.model.beams) b.intensity = night ? 1800 : 0;
    this.model.headMat.emissiveIntensity = night ? 3 : 0.15;
    scene.add(this.model.group);
    this.model.group.traverse((o) => {
      if (o.isMesh) o.castShadow = !o.material.transparent;
    });

    this.car.setTrim(this.settings.trim);
    this.model.setTrim(this.car.trim.key);
    if (cfg.start) {
      this.car.reset(cfg.start.x, cfg.start.z, cfg.start.heading, this.world.heightAt(cfg.start.x, cfg.start.z));
    } else {
      const start = this.track.sample(cfg.carS, cfg.carLateral);
      this.car.reset(start.x, start.z, start.heading);
    }
    this.chaseYaw = this.car.heading;
    this.near = this.track.nearest(this.car.x, this.car.z, -1);
    this.hint = this.near.i;
    this.autopilot.lane = cfg.aiLane;
    this.autopilot.maxSpeed = cfg.aiMaxSpeed ?? Infinity;
    this.autopilot.enabled = attract && !mode.showroom;
    this.attract = attract;
    this.acc = 0;
    this.respawnAt = null;
    this.rig.set(attract ? 'chase' : this.settings.camera);
    this.hud.setMode(mode.title, { gas: this.car.trim.gas > 0, tree: !!cfg.tree, map: this.track.closed });
    if (this.track.closed) this.hud.setTrack(this.track);
    mode.start();
    this.syncModel(0);
  }

  startMode(id) {
    this.audio.init();
    this.audio.setMuted(!this.settings.sound);
    const def = MODE_LIST.find((m) => m.id === id);
    this.modeId = id;
    $('menu').hidden = true;
    $('results').hidden = true;
    this.loadMode(def.make(this));
    this.state = 'running';
    this.input.capture = true;
    this.hud.show(true);
    document.body.classList.add('playing');
    this.hud.toast(`${this.car.trim.name} · ${this.rig.label} · C to change`);
  }

  restart() {
    if (this.modeId) this.startMode(this.modeId);
  }

  pause(on) {
    if (on && this.state === 'running') {
      this.state = 'paused';
      $('pause').hidden = false;
      this.audio.suspend();
    } else if (!on && this.state === 'paused') {
      this.state = 'running';
      $('pause').hidden = true;
      this.last = performance.now();
      this.audio.resume();
    }
  }

  finish(results) {
    this.state = 'results';
    this.autopilot.enabled = false;
    this.results = results;
    $('res-title').textContent = results.title;
    $('res-sub').textContent = results.subtitle || '';
    $('res-sub').className = `sub ${results.tone || ''}`;
    $('res-note').textContent = results.note || '';
    $('res-lines').replaceChildren(
      ...results.lines.map(([k, v, cls]) => {
        const row = document.createElement('div');
        row.className = `row ${cls || ''}`;
        const a = document.createElement('span');
        a.textContent = k;
        const b = document.createElement('b');
        b.textContent = v;
        row.append(a, b);
        return row;
      }),
    );
    setTimeout(() => {
      if (this.state === 'results') $('results').hidden = false;
    }, 400);
    this.refreshBests();
  }

  toMenu() {
    $('pause').hidden = true;
    $('results').hidden = true;
    $('menu').hidden = false;
    this.hud.show(false);
    this.input.capture = false;
    document.body.classList.remove('playing');
    this.audio.resume();
    this.loadMode(new ShowroomMode(this), { attract: true });
    this.state = 'attract';
    this.refreshBests();
  }

  // ------------------------------------------------------------------ simulation
  currentControls() {
    const car = this.car;
    const near = this.near;
    let c;
    if (this.state === 'results') {
      c = { throttle: 0, brake: Math.abs(car.v) > 1 ? 0.5 : 1, steer: this.autopilot.compute(car, this.track, near).steer };
    } else if (this.autopilot.enabled && car.mode !== 'air') {
      c = this.mode.aiControls(this.autopilot.compute(car, this.track, near));
      if (!this.attract) c = this.mode.controls(c);
    } else if (this.autopilot.enabled) {
      // Autopilot in the air: hold attitude and cushion the landing with lift.
      c = { throttle: 0, brake: 0, steer: 0, lift: car.vel[1] < -7 || car.up3()[1] < 0.8 };
    } else {
      c = this.mode.controls({ ...this.controls });
    }
    // Trims without lift jets: the lift key fires the rear thrusters instead.
    if (!car.trim.lift && c.lift) c.boost = true;
    return { boost: false, lift: false, roll: 0, ...c };
  }

  physicsStep(h) {
    const car = this.car;
    const c = this.currentControls();
    this.lastControls = c;
    const env = {
      surface: this.world.surfaceAt(this.near.lateral, car.x, car.z),
      ground: this.ground,
      rails: this.world.rails,
    };
    const wasOn = car.mode === 'ground' ? blockAt(car.x, car.z) : null;
    car.step(h, c, env);
    for (const e of car.events) {
      if (e.type === 'takeoff' && !e.from) e.from = wasOn;
      if (e.type === 'takeoff' && car.air && !car.air.from) car.air.from = e.from;
    }

    let n = this.track.nearest(car.x, car.z, this.hint);
    this.hint = n.i;
    if (car.mode === 'ground') this.collide(n);
    this.bounds();
    n = this.track.nearest(car.x, car.z, this.hint);
    this.near = n;
    this.onRoad = env.surface.onRoad;
    this.handleEvents();
    if (!this.attract && this.state !== 'results') this.mode.step(h, car, n);

    if (car.mode === 'crashed' && this.respawnAt === null) this.respawnAt = 2.6;
    if (this.respawnAt !== null) {
      this.respawnAt -= h;
      if (this.respawnAt <= 0) {
        this.respawnAt = null;
        car.respawn();
      }
    }
  }

  handleEvents() {
    const car = this.car;
    for (const e of car.events) {
      if (this.attract) continue;
      const res = this.mode.onCarEvent(e);
      if (e.type === 'land') {
        const parts = [];
        if (e.flips) parts.push(e.flips > 1 ? `${e.flips}× flip` : 'Flip');
        if (e.rolls) parts.push(e.rolls > 1 ? `${e.rolls}× barrel roll` : 'Barrel roll');
        if (e.spins) parts.push(`${e.spins * 360}° spin`);
        if (e.airtime > 0.6) {
          parts.push(`${e.airtime.toFixed(1)} s air`);
          if (e.dist > 15) parts.push(`${Math.round(e.dist)} m`);
          const pts = typeof res === 'number' && res > 0 ? ` · +${res.toLocaleString()}` : '';
          this.hud.banner(`${e.perfect ? 'Perfect landing! ' : ''}${parts.join(' + ')}${pts}`, 2200, e.perfect ? 'go' : 'split');
        }
        this.fx.burst({ x: car.x, y: car.y, z: car.z }, { dust: Math.min(60, 10 + e.impact * 4) });
        this.audio.impact(Math.min(12, e.impact * 0.8));
        this.rig.bump(Math.min(0.8, e.impact / 20));
      } else if (e.type === 'crash') {
        this.hud.banner('RAPID UNSCHEDULED DISASSEMBLY', 2400, 'bad');
        setTimeout(() => this.hud.toast(CRASH_LINES[e.reason] ?? 'Crashed', 1600), 300);
        this.fx.burst({ x: car.x, y: car.y, z: car.z }, { dust: 50, sparks: 60, smoke: 25 });
        this.audio.impact(15);
        this.rig.bump(1);
        // Give it some tumble so the crash reads.
        car.omega = [(Math.random() - 0.5) * 6, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 8];
      } else if (e.type === 'bump' && e.speed > 3) {
        this.audio.impact(e.speed);
        this.rig.bump(Math.min(1, e.speed / 12));
        this.fx.burst({ x: car.x, y: car.y, z: car.z }, { dust: 10, sparks: Math.round(e.speed * 2) });
      } else if (e.type === 'railEnter') {
        this.hud.toast('Suction fans engaged');
      }
    }
    car.events.length = 0;
  }

  collide(n) {
    const car = this.car;
    const halfW = 1.0;
    const lim = this.cfg.wallOffset - halfW;
    if (Math.abs(n.lateral) > lim) {
      const side = Math.sign(n.lateral);
      const over = Math.abs(n.lateral) - lim;
      const lx = n.tz;
      const lz = -n.tx;
      car.x -= lx * side * over;
      car.z -= lz * side * over;
      let dh = car.heading - n.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      const facingBack = Math.abs(dh) > Math.PI / 2;
      const along = facingBack ? (dh > 0 ? dh - Math.PI : dh + Math.PI) : dh;
      const impact = Math.abs(car.v * Math.sin(along));
      car.heading -= along * 0.6;
      car.yawRate = 0;
      car.v *= Math.max(0.35, 0.97 - impact / 30);
      if (impact > 2) {
        this.audio.impact(impact);
        this.rig.bump(Math.min(1, impact / 12));
        this.fx.burst({ x: car.x, y: 0, z: car.z }, { dust: 0, sparks: Math.round(impact * 3) });
      }
    }
    if (!this.track.closed) {
      const endS = this.track.length - 3;
      if (n.s > endS && car.v > 0) {
        const hit = car.v;
        const p = this.track.sample(endS, n.lateral);
        car.x = p.x;
        car.z = p.z;
        car.v = 0;
        if (hit > 2) {
          this.audio.impact(hit);
          this.rig.bump(1);
        }
        if (this.state === 'running') this.mode.onEndBarrier(hit);
      }
      if (n.s < 1 && car.v < 0) {
        const p = this.track.sample(1, n.lateral);
        car.x = p.x;
        car.z = p.z;
        car.v = 0;
      }
    }
  }

  /** Keep the car inside the arena (and stop it flying off forever elsewhere). */
  bounds() {
    const b = this.cfg.bounds;
    const car = this.car;
    if (b) {
      const dx = car.x - b.x;
      const dz = car.z - b.z;
      const d = Math.hypot(dx, dz);
      if (d > b.r) {
        car.x = b.x + (dx / d) * b.r;
        car.z = b.z + (dz / d) * b.r;
        if (car.mode === 'air') {
          car.vel[0] *= -0.2;
          car.vel[2] *= -0.2;
        } else {
          car.v *= -0.2;
          this.audio.impact(6);
        }
      }
    }
    if (car.y > 400 && car.vel[1] > 0) car.vel[1] = 0; // ceiling
  }

  // ------------------------------------------------------------------ visuals
  syncModel(dt) {
    const car = this.car;
    const m = this.model;
    m.group.position.set(car.x, car.y, car.z);
    m.group.quaternion.set(car.q[0], car.q[1], car.q[2], car.q[3]);
    // Suspension: squat, dive and roll on the ground.
    const grounded = car.mode === 'ground';
    const pitchT = grounded ? THREE.MathUtils.clamp(car.longAcc / 9.81, -2, 2) * 0.012 : 0;
    const rollT = grounded ? THREE.MathUtils.clamp(car.latAcc / 9.81, -2, 2) * 0.012 : 0;
    const k = dt ? 1 - Math.exp(-dt * 8) : 1;
    m.body.rotation.x += (pitchT - m.body.rotation.x) * k;
    m.body.rotation.z += (rollT - m.body.rotation.z) * k;
    // Suction fans pull the body down slightly; wheels droop in the air.
    const droop = car.mode === 'air' || car.mode === 'crashed' ? 0.08 : 0;
    for (const w of m.wheels) {
      w.spin.rotation.x = -car.wheelSpin;
      if (w.front) w.steer.rotation.y = car.steerAngle;
      w.steer.position.y += (w.baseY - droop - w.steer.position.y) * k;
    }
    m.steeringWheel.rotation.z = car.steer * 1.4;
    m.fanBlades.rotation.z += dt * (car.mode === 'air' ? 10 : 45);
    const braking = car.braking || (this.lastControls?.brake ?? 0) > 0.05;
    m.tailMat.emissiveIntensity = braking ? 3.2 : this.settings.time === 'night' ? 1.2 : 0.7;

    // Butterfly doors open in the showroom; active wing deploys with speed, braking and in the air.
    const doorT = this.mode?.showroom ? 1 : 0;
    m.setDoors(m.doorOpen + (doorT - m.doorOpen) * Math.min(1, dt * 1.5));
    const sp = car.speed;
    const wingT = this.mode?.showroom || car.mode !== 'ground' || sp > 35 || (braking && sp > 15) ? 1 : 0;
    m.setWing(m.wingDeploy + (wingT - m.wingDeploy) * Math.min(1, dt * 3));
    // Driver's view is roof-off: hide the glass so nothing blocks the road.
    const showGlass = this.rig.mode !== 'cockpit' || this.attract;
    for (const g of m.glassParts) g.visible = showGlass;
    m.group.updateMatrixWorld();
  }

  emitEffects(dt) {
    const car = this.car;
    const m = this.model;
    const fx = this.fx;
    const vel = car.mode === 'air' ? new THREE.Vector3(...car.vel) : tmpV.set(-Math.sin(car.heading) * car.v, 0, -Math.cos(car.heading) * car.v).clone();
    const world = (n) => {
      const p = m.body.localToWorld(tmpV.copy(n.pos)).clone();
      const d = tmpD.copy(n.dir).transformDirection(m.body.matrixWorld).clone();
      return [p, d];
    };
    if (car.thrusting) {
      m.nozzles.rear.forEach((n, i) => {
        const [p, d] = world(n);
        fx.coldJet('rear' + i, p, d, vel, dt, { power: 1, ground: this.ground });
      });
    }
    if (car.lifting) {
      m.nozzles.lift.forEach((n, i) => {
        const [p, d] = world(n);
        fx.coldJet('lift' + i, p, d, vel, dt, { power: 0.8, ground: this.ground });
      });
    }
    if (car.trim.key === 'rocket' && car.mode === 'air' && car.gas > 0) {
      const [pitch, yaw, roll] = car.rcsInput;
      m.nozzles.side.forEach((n, i) => {
        const xz = n.pos.x * n.pos.z;
        if ((yaw > 0.1 && xz < 0) || (yaw < -0.1 && xz > 0)) {
          const [p, d] = world(n);
          fx.rcsPuff('rcs' + i, p, d, vel, dt);
        }
      });
      m.nozzles.lift.forEach((n, i) => {
        const fire = (pitch > 0.1 && n.pos.z < 0) || (pitch < -0.1 && n.pos.z > 0) || (roll > 0.1 && n.pos.x < 0) || (roll < -0.1 && n.pos.x > 0);
        if (fire && !car.lifting) {
          const [p, d] = world(n);
          fx.rcsPuff('rcsl' + i, p, d, vel, dt);
        }
      });
    }
    if (car.mode === 'ground' && car.slip > 0.45 && car.speed > 3) {
      for (const w of m.wheels) {
        if (w.front) continue;
        const p = w.steer.getWorldPosition(tmpV).clone();
        p.y = car.y;
        fx.tyreSmoke('tyre' + w.steer.position.x, p, car.slip, dt);
      }
    }
  }

  updateChaseFrame(dt) {
    const car = this.car;
    let target = car.heading;
    if (car.mode === 'air' || car.mode === 'crashed') {
      const hs = Math.hypot(car.vel[0], car.vel[2]);
      if (hs > 4) target = Math.atan2(-car.vel[0], -car.vel[2]);
    } else if (car.v < -1) {
      target = car.heading;
    }
    let d = target - this.chaseYaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.chaseYaw += d * Math.min(1, dt * (car.mode === 'air' ? 2.5 : 6));
    this.chaseFrame.position.set(car.x, car.y, car.z);
    this.chaseFrame.rotation.set(0, this.chaseYaw, 0);
    this.chaseFrame.updateMatrixWorld();
  }

  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.state === 'paused' || this.state === 'loading') {
      this.renderer.render(this.scene, this.rig.camera);
      return;
    }

    this.controls = this.input.update(dt, this.car.v, this.car.mode === 'air');
    if (this.mode.showroom) {
      // Slowly rotate on the turntable.
      const car = this.car;
      car.heading += dt * 0.25;
      car.q = [0, Math.sin(car.heading / 2), 0, Math.cos(car.heading / 2)];
    } else {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= PHYS_DT && steps < 12) {
        this.physicsStep(PHYS_DT);
        this.acc -= PHYS_DT;
        steps++;
      }
      if (steps === 12) this.acc = 0;
    }

    this.syncModel(dt);
    this.updateChaseFrame(dt);
    this.world.follow(this.car.x, this.car.z);
    this.rig.update(dt, this.chaseFrame, this.model.body, this.car, this.track, this.near.s, {
      attract: this.attract,
      driverX: this.model.driverX,
      arena: !!this.cfg.arena,
    });
    this.emitEffects(dt);
    const rumble = this.world.update(dt, this.fx, this.rig.camera.position);
    this.fx.setCamera(this.rig.camera, this.renderer.domElement.clientHeight || innerHeight);
    this.fx.update(dt, this.ground);

    if (!this.attract) {
      this.mode.frame(dt);
      this.hud.update(this.car, { units: this.settings.units, autopilot: this.autopilot.enabled, launchArmed: this.car.launchArmed });
      this.hud.setLines(this.mode.hudLines());
      this.hud.drawMap(this.car, this.cfg.arena ? this.world.arena : null);
    }
    const car = this.car;
    this.audio.update({
      speed: car.mode === 'air' ? 0 : car.v,
      powerKW: car.powerKW,
      slip: car.mode === 'ground' ? car.slip : 0,
      jets: (car.thrusting ? 1 : 0) + (car.lifting ? 0.8 : 0) + (car.mode === 'air' && car.trim.key === 'rocket' && car.rcsInput.some((v) => Math.abs(v) > 0.1) ? 0.25 : 0),
      wind: car.speed,
      fan: car.mode === 'ground' || car.mode === 'rail' ? 1 : 0.2,
      rumble,
      offRoad: !this.onRoad && car.mode === 'ground',
      interior: this.rig.mode === 'cockpit',
    });
    this.renderer.render(this.scene, this.rig.camera);
  }
}

// Exposed for debugging and automated tests.
window.roadster = new Game();
window.roadster.SPEC = SPEC;
