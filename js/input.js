// Keyboard, gamepad, touch pedals and tilt steering, merged into one control state.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const ACTION_KEYS = {
  KeyC: 'camera',
  KeyP: 'pause',
  Escape: 'pause',
  KeyT: 'autopilot',
  KeyR: 'reverse',
  KeyM: 'mute',
  KeyF: 'reset',
  Backspace: 'reset',
  Enter: 'confirm',
};

export class Input {
  constructor() {
    this.keys = new Set();
    this.state = { throttle: 0, brake: 0, steer: 0, boost: false, lift: false, roll: 0 };
    this.touch = { throttle: 0, brake: 0, left: false, right: false, boost: false, lift: false, rollL: false, rollR: false };
    this.tilt = { enabled: false, value: 0 };
    this.onAction = () => {};
    this.capture = false; // swallow arrow/space when the game is running
    this.padPrev = {};

    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (this.capture && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!e.repeat && ACTION_KEYS[e.code]) this.onAction(ACTION_KEYS[e.code]);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  bindTouch(root) {
    const bindHold = (el, on, off) => {
      const start = (e) => {
        e.preventDefault();
        el.classList.add('active');
        on();
      };
      const end = (e) => {
        e.preventDefault();
        el.classList.remove('active');
        off();
      };
      el.addEventListener('pointerdown', start);
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      el.addEventListener('pointerleave', end);
    };
    const $ = (sel) => root.querySelector(sel);
    bindHold($('[data-touch=throttle]'), () => (this.touch.throttle = 1), () => (this.touch.throttle = 0));
    bindHold($('[data-touch=brake]'), () => (this.touch.brake = 1), () => (this.touch.brake = 0));
    bindHold($('[data-touch=left]'), () => (this.touch.left = true), () => (this.touch.left = false));
    bindHold($('[data-touch=right]'), () => (this.touch.right = true), () => (this.touch.right = false));
    bindHold($('[data-touch=boost]'), () => (this.touch.boost = true), () => (this.touch.boost = false));
    bindHold($('[data-touch=lift]'), () => (this.touch.lift = true), () => (this.touch.lift = false));
    bindHold($('[data-touch=rollL]'), () => (this.touch.rollL = true), () => (this.touch.rollL = false));
    bindHold($('[data-touch=rollR]'), () => (this.touch.rollR = true), () => (this.touch.rollR = false));
  }

  async enableTilt() {
    const DOE = window.DeviceOrientationEvent;
    if (!DOE) return false;
    if (typeof DOE.requestPermission === 'function') {
      try {
        if ((await DOE.requestPermission()) !== 'granted') return false;
      } catch {
        return false;
      }
    }
    if (!this.tiltBound) {
      this.tiltBound = true;
      addEventListener('deviceorientation', (e) => {
        const angle = screen.orientation?.angle ?? window.orientation ?? 0;
        let tilt;
        if (angle === 90) tilt = e.beta;
        else if (angle === -90 || angle === 270) tilt = -e.beta;
        else tilt = e.gamma;
        this.tilt.value = clamp(-(tilt ?? 0) / 22, -1, 1);
      });
    }
    this.tilt.enabled = true;
    return true;
  }

  /** Smooth digital inputs into analog control values. */
  update(dt, speed = 0, airborne = false) {
    const k = this.keys;
    const up = k.has('ArrowUp') || k.has('KeyW') || this.touch.throttle > 0;
    const down = k.has('ArrowDown') || k.has('KeyS') || this.touch.brake > 0;
    const left = k.has('ArrowLeft') || k.has('KeyA') || this.touch.left;
    const right = k.has('ArrowRight') || k.has('KeyD') || this.touch.right;
    const s = this.state;

    s.throttle = up ? Math.min(1, s.throttle + dt * 6) : Math.max(0, s.throttle - dt * 10);
    s.brake = down ? Math.min(1, s.brake + dt * 8) : Math.max(0, s.brake - dt * 12);

    const target = (left ? 1 : 0) - (right ? 1 : 0);
    // Slower steering response at speed keeps keyboard driving stable.
    // In the air A/D yaws the car, so respond quickly there.
    const rate = airborne ? 8 : (target === 0 ? 5 : 2.6) / (1 + Math.abs(speed) / 40);
    if (s.steer < target) s.steer = Math.min(target, s.steer + dt * rate * (s.steer < 0 && target >= 0 ? 2 : 1));
    else if (s.steer > target) s.steer = Math.max(target, s.steer - dt * rate * (s.steer > 0 && target <= 0 ? 2 : 1));
    if (this.tilt.enabled && !left && !right) s.steer = this.tilt.value;

    s.boost = k.has('ShiftLeft') || k.has('ShiftRight') || this.touch.boost;
    s.lift = k.has('Space') || this.touch.lift;
    s.roll = (k.has('KeyE') || this.touch.rollR ? 1 : 0) - (k.has('KeyQ') || this.touch.rollL ? 1 : 0);
    if (airborne) {
      // Full-strength pitch inputs in the air, no throttle ramp.
      s.throttle = up ? 1 : 0;
      s.brake = down ? 1 : 0;
    }

    this.pollGamepad();
    return s;
  }

  pollGamepad() {
    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const s = this.state;
      const rt = p.buttons[7]?.value ?? 0;
      const lt = p.buttons[6]?.value ?? 0;
      const ax = p.axes[0] ?? 0;
      if (rt > 0.05) s.throttle = rt;
      if (lt > 0.05) s.brake = lt;
      if (Math.abs(ax) > 0.08) s.steer = -Math.sign(ax) * ((Math.abs(ax) - 0.08) / 0.92) ** 1.5;
      if (p.buttons[0]?.pressed) s.lift = true;
      if (p.buttons[1]?.pressed) s.boost = true;
      const lb = p.buttons[4]?.pressed ? 1 : 0;
      const rb = p.buttons[5]?.pressed ? 1 : 0;
      if (lb || rb) s.roll = rb - lb;
      const ay = p.axes[1] ?? 0;
      if (Math.abs(ay) > 0.2 && s.throttle < 0.05 && s.brake < 0.05) {
        // Left stick up/down pitches in the air.
        if (ay < 0) s.throttle = -ay;
        else s.brake = ay;
      }
      const edge = (i, action) => {
        const pressed = !!p.buttons[i]?.pressed;
        if (pressed && !this.padPrev[i]) this.onAction(action);
        this.padPrev[i] = pressed;
      };
      edge(3, 'camera');
      edge(9, 'pause');
      edge(2, 'autopilot');
      edge(8, 'reset');
      edge(12, 'reverse');
      break;
    }
  }
}
