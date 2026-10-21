import * as THREE from 'three';
import { CarPhysics, SPEC } from './car.js';
import { buildRoadster, PAINTS } from './roadsterModel.js';
import { World } from './world.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { Hud } from './hud.js';
import { CameraRig } from './camera.js';
import { Autopilot } from './autopilot.js';
import { MODE_LIST, CircuitMode } from './modes.js';
import { loadSettings, saveSettings, Bests } from './storage.js';
import { fmtLap, fmtSec, fmtSpeed } from './format.js';

const PHYS_DT = 1 / 120;
const $ = (id) => document.getElementById(id);

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
    this.autopilot = new Autopilot();
    this.car = new CarPhysics({ thrusterPack: this.settings.thrusters });
    this.model = buildRoadster(this.settings.paint);
    this.hint = -1;
    this.acc = 0;
    this.last = performance.now();
    this.controls = { throttle: 0, brake: 0, steer: 0, boost: false };

    this.input.onAction = (a) => this.onAction(a);
    this.input.bindTouch($('touch'));
    addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'running') this.pause(true);
    });
    this.resize();
    this.bindUi();

    // Menu backdrop: the car driving itself around the coast at the chosen time of day.
    this.loadMode(new CircuitMode(this, 0), { attract: true });
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
      if (this.state === 'attract') this.loadMode(new CircuitMode(this, 0), { attract: true });
    });
    seg('opt-thrusters', 'thrusters', () => (this.car.thrusterPack = s.thrusters));
    seg('opt-sound', 'sound', () => this.audio.setMuted(!s.sound));
    seg('opt-shadows', 'shadows', () => {
      this.renderer.shadowMap.enabled = s.shadows;
      this.world.scene?.traverse((o) => o.material && (o.material.needsUpdate = true));
    });

    $('btn-camera').addEventListener('click', () => this.onAction('camera'));
    $('btn-pause').addEventListener('click', () => this.onAction('pause'));
    $('btn-ap').addEventListener('click', () => this.onAction('autopilot'));
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
  }

  saveSettings() {
    saveSettings(this.settings);
  }

  refreshBests() {
    const u = this.settings.units;
    const b = this.best;
    const text = {
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
        this.hud.toast(this.autopilot.enabled ? 'Autopilot ride-along: on' : 'Autopilot: off — you have control');
      } else if (a === 'reverse') {
        const want = this.car.gear === 'R' ? 'D' : 'R';
        if (this.car.setGear(want)) this.hud.toast(want === 'R' ? 'Reverse' : 'Drive');
        else this.hud.toast('Stop to change gear');
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

    const night = this.settings.time === 'night';
    for (const b of this.model.beams) b.intensity = night ? 1800 : 0;
    this.model.headMat.emissiveIntensity = night ? 3 : 1.2;
    scene.add(this.model.group);
    this.model.group.traverse((o) => {
      if (o.isMesh) o.castShadow = o.material !== this.model.canopy.material;
    });

    const start = this.track.sample(cfg.carS, cfg.carLateral);
    this.car.reset(start.x, start.z, start.heading);
    this.car.thrusterPack = this.settings.thrusters;
    this.hint = -1;
    this.near = this.track.nearest(this.car.x, this.car.z, -1);
    this.hint = this.near.i;
    this.autopilot.lane = cfg.aiLane;
    this.autopilot.maxSpeed = cfg.aiMaxSpeed ?? Infinity;
    this.autopilot.enabled = attract;
    this.attract = attract;
    this.acc = 0;
    this.rig.set(attract ? 'chase' : this.settings.camera);
    this.hud.setMode(mode.title, { thrusters: this.settings.thrusters, tree: !!cfg.tree, map: this.track.closed });
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
    this.hud.toast(`${this.rig.label} · C to change`);
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
    this.loadMode(new CircuitMode(this, 0), { attract: true });
    this.state = 'attract';
    this.refreshBests();
  }

  // ------------------------------------------------------------------ simulation
  physicsStep(h) {
    const car = this.car;
    const near = this.near;
    let c;
    if (this.state === 'results') {
      // Let the car roll to a gentle stop behind the results card.
      c = { throttle: 0, brake: Math.abs(car.v) > 1 ? 0.5 : 1, steer: this.autopilot.compute(car, this.track, near).steer, boost: false };
    } else if (this.autopilot.enabled) {
      c = this.mode.aiControls(this.autopilot.compute(car, this.track, near));
      if (!this.attract) c = this.mode.controls(c);
    } else {
      c = this.mode.controls({ ...this.controls });
    }
    this.lastControls = c;
    const surface = this.world.surfaceAt(near.lateral);
    car.step(h, c, surface);

    let n = this.track.nearest(car.x, car.z, this.hint);
    this.hint = n.i;
    this.collide(n);
    n = this.track.nearest(car.x, car.z, this.hint);
    this.near = n;
    this.onRoad = surface.onRoad;
    if (!this.attract && this.state !== 'results') this.mode.step(h, car, n);
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
      // Glance off: align with the wall and scrub speed.
      car.heading -= along * 0.6;
      car.yawRate = 0;
      car.v *= Math.max(0.35, 0.97 - impact / 30);
      if (impact > 2) {
        this.audio.impact(impact);
        this.rig.bump(Math.min(1, impact / 12));
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

  syncModel(dt) {
    const car = this.car;
    const m = this.model;
    m.group.position.set(car.x, 0, car.z);
    m.group.rotation.y = car.heading;
    // Suspension: squat under acceleration, dive under braking, roll in corners.
    const pitchT = THREE.MathUtils.clamp(car.longAcc / 9.81, -1.5, 1.5) * 0.018;
    const rollT = THREE.MathUtils.clamp(car.latAcc / 9.81, -1.5, 1.5) * 0.022;
    const k = dt ? 1 - Math.exp(-dt * 8) : 1;
    m.body.rotation.x += (pitchT - m.body.rotation.x) * k;
    m.body.rotation.z += (rollT - m.body.rotation.z) * k;
    m.body.position.y = Math.abs(m.body.rotation.x) * 0.3;
    for (const w of m.wheels) {
      w.spin.rotation.x = -car.wheelSpin;
      if (w.front) w.steer.rotation.y = car.steerAngle;
    }
    m.steeringWheel.rotation.z = car.steer * 2.2;
    const braking = car.braking || (this.lastControls?.brake ?? 0) > 0.05;
    m.tailMat.emissiveIntensity = braking ? 3.2 : this.settings.time === 'night' ? 1 : 0.5;
    const flame = car.thrusting ? 0.55 : 0;
    m.flameMat.opacity += (flame - m.flameMat.opacity) * (dt ? Math.min(1, dt * 20) : 1);
    for (const f of m.flames) {
      f.visible = m.flameMat.opacity > 0.02;
      f.scale.setScalar(0.8 + Math.random() * 0.4);
    }
    // The glass roof hides from the cockpit cam so the view is clear (roof off!).
    m.canopy.visible = this.rig.mode !== 'cockpit' || this.attract;
  }

  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.state === 'paused' || this.state === 'loading') {
      this.renderer.render(this.scene, this.rig.camera);
      return;
    }

    this.controls = this.input.update(dt, this.car.v);
    this.acc += dt;
    let steps = 0;
    while (this.acc >= PHYS_DT && steps < 12) {
      this.physicsStep(PHYS_DT);
      this.acc -= PHYS_DT;
      steps++;
    }
    if (steps === 12) this.acc = 0;

    this.syncModel(dt);
    this.world.follow(this.car.x, this.car.z);
    this.rig.update(dt, this.model.group, this.model.body, this.car, this.track, this.near.s, { attract: this.attract });

    if (!this.attract) {
      this.mode.frame(dt);
      this.hud.update(this.car, { units: this.settings.units, autopilot: this.autopilot.enabled, launchArmed: this.car.launchArmed });
      this.hud.setLines(this.mode.hudLines());
      this.hud.drawMap(this.car);
    }
    this.audio.update({
      speed: this.car.v,
      powerKW: this.car.powerKW,
      slip: this.car.slip,
      thrusting: this.car.thrusting,
      offRoad: !this.onRoad,
      interior: this.rig.mode === 'cockpit',
    });
    this.renderer.render(this.scene, this.rig.camera);
  }
}

// Exposed for debugging and automated tests.
window.roadster = new Game();
window.roadster.SPEC = SPEC;
