let ctx = null;

export function actx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(f, dur, type = 'sine', g = 0.08, slide = 0) {
  try {
    const c = actx();
    const o = c.createOscillator();
    const gn = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, c.currentTime);
    if (slide) o.frequency.linearRampToValueAtTime(Math.max(30, f + slide), c.currentTime + dur);
    gn.gain.setValueAtTime(g, c.currentTime);
    gn.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.connect(gn).connect(c.destination);
    o.start();
    o.stop(c.currentTime + dur + 0.02);
  } catch { /* audio not ready yet */ }
}

export const sfx = {
  swing() { tone(300, 0.09, 'triangle', 0.05, -160); },
  hit() { tone(180, 0.12, 'square', 0.09, -60); },
  hurt() { tone(110, 0.25, 'sawtooth', 0.12, -40); },
  jump() { tone(320, 0.12, 'sine', 0.05, 120); },
  cp() {
    tone(523, 0.15, 'sine', 0.09);
    setTimeout(() => tone(659, 0.15, 'sine', 0.09), 120);
    setTimeout(() => tone(784, 0.3, 'sine', 0.09), 240);
  },
  roar() {
    tone(70, 1.0, 'sawtooth', 0.16, 40);
    setTimeout(() => tone(55, 0.9, 'sawtooth', 0.12, -15), 220);
  },
  die() { tone(200, 0.6, 'sawtooth', 0.1, -150); },
  mobdie() { tone(420, 0.2, 'square', 0.06, -260); },
};
