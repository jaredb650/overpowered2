/**
 * The main menu's background: the switch, the smoking rhythm, the framing, the pose's cigar, and that showing, hiding
 * and freeing it leaves nothing behind. Runs in Node with a stand-in body built from the real rig, so the pose maths is
 * the real thing and only the skin is missing.
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { humanoidRig, HumanoidBone as H } from '../../characters/rig';
import type { Ctx } from '../../core/contracts';
import type { Backdrop } from '../../render/Renderer';
import { MenuBackdrop, framing } from './MenuBackdrop';
import { DRAG_SECONDS, EMBER, EVERY, FIRST_DRAG, SmokeRhythm, backdropMode } from './rhythm';
import { CIGAR_LENGTH, Smoker } from './smoker';

/** Deterministic 0..1. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** Bones in bind pose on the real rig, under a root, the way `Character` builds them. */
function standIn() {
  const rig = humanoidRig('contractor', { bulk: 1.04 });
  const root = new THREE.Group();
  const bones = rig.bones.map(b => {
    const bone = new THREE.Bone();
    bone.position.set(...b.offset);
    return bone;
  });
  rig.bones.forEach((b, i) => (b.parent >= 0 ? bones[b.parent]! : root).add(bones[i]!));
  const material = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), material);
  root.add(mesh);
  const released = vi.fn();
  return { rig, root, bones, mesh, a: { material }, release: released, released };
}

describe('backdropMode', () => {
  it('reads ?menubg, then reduced motion; it moves at every graphics quality', () => {
    expect(backdropMode('map', false, 2)).toBe('map');
    expect(backdropMode('still', false, 2)).toBe('still');
    expect(backdropMode('heli', true, 0)).toBe('heli');
    expect(backdropMode(null, false, 2)).toBe('heli');
    expect(backdropMode(null, true, 2)).toBe('still');
    expect(backdropMode(null, false, 0)).toBe('heli');
    expect(backdropMode('nonsense', false, 3)).toBe('heli');
  });
});

describe('SmokeRhythm', () => {
  const run = (seconds: number, seed = 7) => {
    const r = new SmokeRhythm(seeded(seed));
    const dt = 1 / 60;
    const frames: { t: number; hand: number; draw: number; ember: number; exhale: number; look: number }[] = [];
    for (let t = 0; t < seconds; t += dt) {
      r.update(dt);
      frames.push({ t: r.time, ...r.pose });
    }
    return { r, frames };
  };

  /** Times at which the hand starts to rise. */
  const dragStarts = (frames: { t: number; hand: number }[]) => {
    const out: number[] = [];
    for (let i = 1; i < frames.length; i++) if (frames[i - 1]!.hand === 0 && frames[i]!.hand > 0) out.push(frames[i]!.t);
    return out;
  };

  it('starts a drag soon, then one every ten to fifteen seconds', () => {
    for (const seed of [1, 7, 99]) {
      const starts = dragStarts(run(130, seed).frames);
      expect(starts[0]).toBeCloseTo(FIRST_DRAG, 1);
      expect(starts.length).toBeGreaterThanOrEqual(8);
      for (let i = 1; i < starts.length; i++) {
        const gap = starts[i]! - starts[i - 1]!;
        expect(gap).toBeGreaterThanOrEqual(EVERY.min - 0.05);
        expect(gap).toBeLessThanOrEqual(EVERY.max + 0.05);
      }
    }
  });

  it('brightens the tip on every drag and lets it cool between them', () => {
    const { frames } = run(130);
    const starts = dragStarts(frames);
    for (const s of starts.slice(0, -1)) {
      const during = frames.filter(f => f.t >= s && f.t < s + DRAG_SECONDS);
      expect(Math.max(...during.map(f => f.ember))).toBeGreaterThan(0.9);
      // Just before the next drag the tip is back at rest.
      const before = frames.filter(f => f.t > s + DRAG_SECONDS + 2.5 && f.t < s + EVERY.min - 0.1);
      for (const f of before) expect(f.ember).toBeCloseTo(EMBER.rest, 2);
    }
    // It cools, it does not snap: no frame drops by more than the cooling rate allows.
    for (let i = 1; i < frames.length; i++) expect(frames[i - 1]!.ember - frames[i]!.ember).toBeLessThanOrEqual(EMBER.cool / 60 + 1e-6);
  });

  it('breathes out after the draw, with the hand down, and never looks away mid-drag', () => {
    const { frames } = run(130);
    for (const f of frames) {
      if (f.exhale > 0.05) {
        expect(f.hand).toBe(0);
        expect(f.draw).toBe(0);
      }
      if (f.hand > 0) expect(f.look).toBe(0);
    }
    expect(frames.some(f => f.exhale > 0.9)).toBe(true);
    expect(frames.some(f => f.look > 0.9)).toBe(true);
  });
});

describe('framing', () => {
  it('puts the subject between the menu list and the notice, above the wordmark, at every shape of screen', () => {
    for (const [w, h] of [[1280, 720], [1440, 900], [1920, 1080], [2560, 1080], [3440, 1440], [1024, 768]] as const) {
      const rem = Math.min(w / 120, h / 67.5);
      const s = framing(w, h);
      // A point at the centre of the view lands at -shift in device units.
      const x = (1 - s.x) / 2 * w;
      const y = (1 + s.y) / 2 * h;
      expect(x).toBeGreaterThan(20 * rem);
      expect(x).toBeLessThan(w - 53.4 * rem);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(h - 25 * rem);
    }
  });

  it('on the splash, keeps his head, chest and cigar hand above the centred wordmark, in the same column', () => {
    for (const [w, h] of [[1280, 720], [1440, 900], [1920, 1080], [2560, 1080], [3440, 1440], [1024, 768]] as const) {
      const rem = Math.min(w / 120, h / 67.5);
      const s = framing(w, h, 'splash');
      const aim = (1 + s.y) / 2 * h;
      // The head is about 0.14 of the height above the aim, the resting hand 0.07 below it.
      expect(aim - 0.14 * h).toBeGreaterThan(0.03 * h);
      expect(aim + 0.07 * h).toBeLessThan(h / 2 - 10.5 * rem);
      expect(s.x).toBeCloseTo(framing(w, h, 'menu').x, 6);
    }
  });
});

describe('Smoker', () => {
  const lips = (body: ReturnType<typeof standIn>, mouth: THREE.Vector3) => mouth.applyMatrix4(body.bones[H.head]!.matrixWorld);

  it('brings the cigar to his lips on a drag, and rests it by the left knee', () => {
    const body = standIn();
    const scene = new THREE.Scene();
    scene.add(body.root);
    const smoker = new Smoker(body as never, [0.012, 0.027, 0.104]);
    scene.add(smoker.cigar);
    const pose = { hand: 1, draw: 1, ember: 1, exhale: 0, look: 0, shift: 0 };
    smoker.update(pose, 0, new THREE.Vector2());
    const butt = new THREE.Vector3().applyMatrix4(smoker.cigar.matrix);
    expect(butt.distanceTo(lips(body, new THREE.Vector3(0.012, 0.027, 0.104)))).toBeLessThan(0.02);

    pose.hand = 0;
    smoker.update(pose, 0, new THREE.Vector2());
    const knee = new THREE.Vector3().setFromMatrixPosition(body.bones[H.shinL]!.matrixWorld);
    const tip = smoker.tip(new THREE.Vector3());
    expect(tip.distanceTo(knee)).toBeLessThan(0.3);
    // And the lit end is the far end of a cigar's length from the butt.
    expect(tip.distanceTo(new THREE.Vector3().applyMatrix4(smoker.cigar.matrix))).toBeCloseTo(CIGAR_LENGTH, 3);
    smoker.dispose();
  });

  it('keeps him on the cabin floor and his right boot outside the door', () => {
    const body = standIn();
    const scene = new THREE.Scene();
    scene.add(body.root);
    const smoker = new Smoker(body as never, null);
    for (const shift of [0, 1]) {
      smoker.update({ hand: 0, draw: 0, ember: 0.3, exhale: 0, look: 0, shift }, 3, new THREE.Vector2());
      const p = new THREE.Vector3();
      for (const b of [H.hips, H.footL, H.footR, H.head]) {
        p.setFromMatrixPosition(body.bones[b]!.matrixWorld);
        expect(p.y).toBeGreaterThan(-1.25);
      }
      expect(p.setFromMatrixPosition(body.bones[H.footR]!.matrixWorld).x).toBeGreaterThan(1.4);
      expect(p.setFromMatrixPosition(body.bones[H.footL]!.matrixWorld).x).toBeLessThan(1.25);
      expect(p.setFromMatrixPosition(body.bones[H.head]!.matrixWorld).y).toBeGreaterThan(-0.5);
    }
    smoker.dispose();
  });
});

describe('MenuBackdrop', () => {
  function setup(load: () => Promise<void> = async () => {}) {
    const body = standIn();
    const hook: { backdrop: Backdrop | null } = { backdrop: null };
    const loop = { alive: true, setVolume: vi.fn(), setPitch: vi.fn(), setPosition: vi.fn(), stop: vi.fn() };
    const lib = {
      load: vi.fn(load),
      spawn: vi.fn(() => body),
      sockets: () => ({ mouth: { pos: [0.012, 0.027, 0.104] } }),
      plainMaterial: vi.fn(async () => new THREE.MeshStandardMaterial()),
      unload: vi.fn(() => true),
    };
    const audio = { startLoop: vi.fn(() => loop), has: () => true };
    const ctx = { render: hook, characters: lib, audio } as unknown as Ctx;
    return { bd: new MenuBackdrop(ctx), hook, lib, audio, loop, body };
  }

  const settle = () => new Promise(r => setTimeout(r, 0));

  it('builds on demand, hands itself to the renderer, and steps aside when hidden or switched to the map', async () => {
    const { bd, hook } = setup();
    bd.update(1 / 60, true, 'map', false);
    expect(bd.built).toBe(false);
    expect(hook.backdrop).toBeNull();
    bd.update(1 / 60, true, 'heli', false);
    await settle();
    bd.update(1 / 60, true, 'heli', false);
    expect(bd.built).toBe(true);
    expect(hook.backdrop?.scene).toBe(bd.scene);
    expect(hook.backdrop?.still).toBe(false);
    expect(bd.stats().body).toBe(true);
    bd.update(1 / 60, false, 'heli', false);
    expect(hook.backdrop).toBeNull();
    // Hidden, not freed: a trip to the rules screen does not reload the model.
    expect(bd.built).toBe(true);
    // Still only once the body is in and the fade from black has finished, so the frame the renderer keeps is the whole picture.
    bd.update(1 / 60, true, 'still', false);
    expect(hook.backdrop?.still).toBe(false);
    for (let i = 0; i < 3; i++) bd.update(1 / 60, true, 'still', false);
    expect(hook.backdrop?.still).toBe(true);
    bd.dispose();
  });

  it('opens on the splash framing and tilts to the menu one over a second or two, but cuts when still', async () => {
    const { bd } = setup();
    const shiftY = () => bd.camera.projectionMatrix.elements[9]!;
    const w = globalThis.innerWidth ?? 1440, h = globalThis.innerHeight ?? 900;
    bd.update(1 / 60, true, 'heli', false, 'splash');
    await settle();
    bd.update(1 / 60, true, 'heli', false, 'splash');
    expect(shiftY()).toBeCloseTo(framing(w, h, 'splash').y, 5);
    bd.update(1 / 60, true, 'heli', true, 'menu');
    const first = shiftY();
    expect(Math.abs(first - framing(w, h, 'splash').y)).toBeLessThan(0.02);
    for (let i = 0; i < 120; i++) bd.update(1 / 60, true, 'heli', true, 'menu');
    expect(shiftY()).toBeCloseTo(framing(w, h, 'menu').y, 5);
    bd.update(1 / 60, true, 'still', true, 'splash');
    expect(shiftY()).toBeCloseTo(framing(w, h, 'splash').y, 5);
    bd.dispose();
  });

  it('plays the cabin quietly only once sound is allowed, and stops it when the menu goes', async () => {
    const { bd, audio, loop } = setup();
    bd.update(1 / 60, true, 'heli', false);
    await settle();
    bd.update(1 / 60, true, 'heli', false);
    expect(audio.startLoop).not.toHaveBeenCalled();
    bd.update(1 / 60, true, 'heli', true);
    bd.update(1 / 60, true, 'heli', true);
    expect(audio.startLoop).toHaveBeenCalledTimes(1);
    const options = (audio.startLoop.mock.calls[0] as unknown[])[1] as { volume: number };
    expect(options.volume).toBeLessThan(0.15);
    bd.update(1 / 60, false, 'heli', true);
    expect(loop.stop).toHaveBeenCalled();
    bd.dispose();
  });

  it('frees every geometry, material and texture it made, gives the body back and unloads the model', async () => {
    const { bd, hook, lib, body } = setup();
    bd.update(1 / 60, true, 'heli', true);
    await settle();
    for (let i = 0; i < 30; i++) bd.update(1 / 30, true, 'heli', true);
    const owned = new Set<THREE.EventDispatcher<{ dispose: object }>>();
    bd.scene.traverse(o => {
      const m = o as THREE.Mesh;
      // The body's mesh and skin belong to the library, which frees them on unload.
      if (o === body.mesh) return;
      if (m.geometry) owned.add(m.geometry);
      for (const mat of Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) owned.add(mat);
    });
    for (const o of bd.camera.children) {
      const m = o as THREE.Mesh;
      owned.add(m.geometry);
      owned.add(m.material as THREE.Material);
    }
    expect(owned.size).toBeGreaterThan(15);
    const freed = new Set<unknown>();
    for (const o of owned) o.addEventListener('dispose', () => freed.add(o));
    bd.dispose();
    expect([...owned].filter(o => !freed.has(o))).toEqual([]);
    expect(hook.backdrop).toBeNull();
    expect(bd.built).toBe(false);
    expect(body.released).toHaveBeenCalledTimes(1);
    expect(lib.unload).toHaveBeenCalledWith('contractor');
    let objects = 0;
    bd.scene.traverse(() => { objects++; });
    expect(objects).toBe(1);
    // A second dispose is harmless.
    bd.dispose();
    expect(body.released).toHaveBeenCalledTimes(1);
  });

  it('drops a model that finishes loading after the run has started', async () => {
    let finish = () => {};
    const { bd, lib } = setup(() => new Promise<void>(r => { finish = r; }));
    bd.update(1 / 60, true, 'heli', false);
    bd.dispose();
    finish();
    await settle();
    await settle();
    expect(lib.spawn).not.toHaveBeenCalled();
    expect(lib.unload).toHaveBeenCalledWith('contractor');
    expect(bd.built).toBe(false);
  });
});
