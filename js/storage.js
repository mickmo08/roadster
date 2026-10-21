// Settings and personal bests in localStorage. Every access is guarded: storage
// can be unavailable (private windows, blocked site data) and the game must
// still run.

const SETTINGS_KEY = 'roadster.settings.v1';
const BEST_KEY = 'roadster.best.v1';

const DEFAULTS = {
  units: 'mph',
  paint: 'red',
  time: 'sunset',
  thrusters: false,
  sound: true,
  shadows: true,
  camera: 'chase',
};

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function loadSettings() {
  return { ...DEFAULTS, ...(read(SETTINGS_KEY) || {}) };
}

export function saveSettings(s) {
  write(SETTINGS_KEY, s);
}

export class Bests {
  constructor() {
    this.data = read(BEST_KEY) || {};
  }

  get(key) {
    return this.data[key];
  }

  /** Record value if it beats the stored best. Returns true when it's a new best. */
  check(key, value, dir) {
    if (!isFinite(value) || value <= 0) return false;
    const cur = this.data[key];
    const better = cur === undefined || (dir === 'min' ? value < cur : value > cur);
    if (better) {
      this.data[key] = value;
      write(BEST_KEY, this.data);
    }
    return better;
  }
}
