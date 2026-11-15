const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
const controller = html.slice(html.indexOf('  let last = 0,'), html.indexOf('\n})();', html.indexOf('  let last = 0,')));

function device(reduced = false) {
  let now = 0, sequence = 0, intersect, preferenceChanged, visibilityChanged;
  let draws = 0, cost = 0, resets = 0;
  const pending = new Map();
  const document = {
    hidden: false,
    documentElement: { dataset: {} },
    querySelectorAll: () => [],
    addEventListener: (_, fn) => { visibilityChanged = fn; },
  };
  const preference = { matches: reduced, addEventListener: (_, fn) => { preferenceChanged = fn; } };
  const context = vm.createContext({
    document, motionPreference: preference, hero: {}, time: 0, dock: {}, hatch: {},
    panel: { classList: { remove() {} } },
    performance: { now: () => now },
    requestAnimationFrame: (fn) => { pending.set(++sequence, fn); return sequence; },
    cancelAnimationFrame: (id) => pending.delete(id),
    IntersectionObserver: class {
      constructor(fn) { intersect = fn; }
      observe() {}
    },
    update() {}, layout() {},
    draw() { draws++; now += cost; },
    reset() { resets++; },
  });
  vm.runInContext(`let quality = 'full'; const motionMode = () => motionPreference.matches ? 'static' : quality; ${controller}`, context);
  intersect([{ isIntersecting: true }]);
  return {
    get mode() { return document.documentElement.dataset.motion; },
    get draws() { return draws; },
    get resets() { return resets; },
    get scheduled() { return pending.size; },
    set cost(value) { cost = value; },
    run(duration, interval = 1000 / 60) {
      const end = now + duration;
      while (now < end) {
        now += interval;
        const callbacks = [...pending.values()];
        pending.clear();
        callbacks.forEach((fn) => fn(now));
        assert.ok(pending.size <= 1, 'only one animation loop');
      }
    },
    intersect(value) { intersect([{ isIntersecting: value }]); },
    hide(value) { document.hidden = value; visibilityChanged(); },
    reduce(value) { preference.matches = value; preferenceChanged(); },
  };
}

test('all inline scripts parse', () => {
  for (const [, source] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(source);
});

test('healthy 60 Hz, 120 Hz and 144 Hz devices stay full with a 60 fps render cap', () => {
  for (const hz of [60, 120, 144]) {
    const d = device();
    d.run(12000, 1000 / hz);
    assert.equal(d.mode, 'full');
    assert.ok(d.draws >= 710 && d.draws <= 725);
  }
});

test('sustained 30 Hz delivery selects light mode and renders at 30 fps', () => {
  const d = device();
  d.run(8000, 1000 / 30);
  assert.equal(d.mode, 'light');
  const before = d.draws;
  d.run(2000);
  assert.ok(d.draws - before >= 59 && d.draws - before <= 61);
  assert.equal(d.mode, 'light');
});

test('persistent slow frames reach an assembled static scene and stop scheduling', () => {
  const d = device();
  d.run(15000, 80);
  assert.equal(d.mode, 'static');
  assert.equal(d.resets, 2);
  assert.equal(d.scheduled, 0);
  const before = d.draws;
  d.run(10000);
  assert.equal(d.draws, before);
  d.hide(true); d.hide(false);
  assert.equal(d.scheduled, 0);
});

test('costly rendering also triggers fallback', () => {
  const d = device();
  d.cost = 12;
  d.run(8000, 10);
  assert.equal(d.mode, 'light');
});

test('a transient stall does not lower quality', () => {
  const d = device();
  d.run(3000); d.run(2500, 80); d.run(8000);
  assert.equal(d.mode, 'full');
});

test('hidden and offscreen periods pause and do not poison samples', () => {
  const d = device();
  d.run(3000);
  for (const toggle of [d.hide, (hidden) => d.intersect(!hidden)]) {
    toggle(true);
    assert.equal(d.scheduled, 0);
    const before = d.draws;
    d.run(30000, 1000);
    assert.equal(d.draws, before);
    toggle(false);
    d.run(8000);
    assert.equal(d.mode, 'full');
  }
});

test('reduced motion starts static and reacts to live preference changes', () => {
  const d = device(true);
  assert.equal(d.mode, 'static');
  assert.equal(d.scheduled, 0);
  d.reduce(false); d.run(1000);
  assert.equal(d.mode, 'full');
  assert.ok(d.draws > 1);
  d.reduce(true);
  assert.equal(d.mode, 'static');
  assert.equal(d.scheduled, 0);
});

test('toggling reduced motion preserves a performance downgrade', () => {
  const d = device();
  d.run(8000, 1000 / 30);
  d.reduce(true); d.reduce(false);
  assert.equal(d.mode, 'light');
});
