/** FLIR Thermal Vision unit tests: post-grade optics (no CSS invert), 32 m smooth falloff, visibleFill glow, cooling corpses, and registered heat sources. */
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx, GradeName } from '../core/contracts';
import { GameTime } from '../core/time';
import { XRay } from '../render/XRay';
import { GRADES } from '../render/post/grades';
import { Chips, THERMAL, THERMAL_CORPSE_COOL, THERMAL_FALLOFF_START, THERMAL_RANGE } from './chips';
import { Sonar } from './sonar';

const FPS = 60;

interface HighlightCall {
  meshes: THREE.Object3D[];
  color: THREE.ColorRepresentation;
  strength: number;
  visibleFill: number;
}

interface GradeCall {
  name: GradeName;
  blendSeconds: number | undefined;
}

interface TestEnemy {
  position: THREE.Vector3;
  char: { mesh: THREE.Object3D };
}

function createRig() {
  const down = new Set<string>();
  const pressed = new Set<string>();
  const released = new Set<string>();
  const handlers = new Map<string, ((e: unknown) => void)[]>();
  const highlights: HighlightCall[] = [];
  const postGrades: GradeCall[] = [];
  const heldGrades: (GradeName | null)[] = [];
  const sounds: string[] = [];
  const taps: boolean[] = [];
  const style = { filter: '' };
  const enemies: TestEnemy[] = [];
  const player = {
    alive: true,
    parked: false,
    eye: new THREE.Vector3(0, 1.6, 0),
    position: new THREE.Vector3(0, 0, 0),
  };

  const ctx = {
    time: new GameTime(),
    input: {
      pressed: (a: string) => pressed.has(a),
      isDown: (a: string) => down.has(a),
      released: (a: string) => released.has(a),
      labelFor: () => 'T',
    },
    events: {
      on: (k: string, fn: (e: unknown) => void) => handlers.set(k, [...(handlers.get(k) ?? []), fn]),
      emit: (k: string, e: unknown) => {
        if (k === 'thermal:tap') taps.push((e as { on: boolean }).on);
        for (const fn of handlers.get(k) ?? []) fn(e);
      },
    },
    audio: { play: (id: string) => { sounds.push(id); } },
    hud: { callout: () => {} },
    player,
    enemies: { remaining: 0, alive: enemies },
    world: { bounds: new THREE.Box3(new THREE.Vector3(-80, 0, -80), new THREE.Vector3(80, 16, 80)) },
    render: {
      renderer: { domElement: { style } },
      post: {
        setGrade: (name: GradeName, blendSeconds?: number) => postGrades.push({ name, blendSeconds }),
      },
      highlight: (meshes: readonly THREE.Object3D[], color: THREE.ColorRepresentation, strength = 1, visibleFill = 0) => {
        highlights.push({ meshes: [...meshes], color, strength, visibleFill });
      },
      sweep: () => {},
    },
    progression: {
      holdGrade: (g: GradeName | null) => heldGrades.push(g),
    },
  } as unknown as Ctx;

  const sonar = new Sonar(ctx);
  const chips = new Chips(ctx, sonar);
  chips.rack.fit('thermal', true);

  const step = (dt = 1 / FPS, tap = false): void => {
    highlights.length = 0;
    pressed.clear();
    released.clear();
    if (tap) {
      pressed.add('sonar');
      down.add('sonar');
    } else if (down.has('sonar')) {
      released.add('sonar');
      down.delete('sonar');
    }
    ctx.time.tick(dt);
    chips.update();
  };

  const advance = (seconds: number): void => {
    const steps = Math.round(seconds * FPS);
    for (let i = 0; i < steps; i++) step(1 / FPS);
  };

  return { ctx, chips, enemies, player, style, highlights, postGrades, heldGrades, sounds, taps, step, advance };
}

let r: ReturnType<typeof createRig>;
beforeEach(() => {
  r = createRig();
});

describe('FLIR Thermal Vision', () => {
  it('applies AC-130 black-hot filter, visor tap animation, and thermal_activate audio on toggle', () => {
    expect(THERMAL.filter).toBe('grayscale(1) contrast(1.3) invert(1)');
    expect(THERMAL.enemyColor).toBe('#ffffff');

    r.step(1 / FPS, true);
    expect(r.chips.thermal).toBe(true);
    expect(r.style.filter).toBe(THERMAL.filter);
    expect(r.taps).toEqual([true]);
    expect(r.sounds).toContain('thermal_activate');

    r.step(1 / FPS);
    r.step(1 / FPS, true);
    expect(r.chips.thermal).toBe(false);
    expect(r.style.filter).toBe('');
    expect(r.taps).toEqual([true, false]);
    expect(r.sounds.filter(s => s === 'thermal_activate')).toHaveLength(2);
  });

  it('activates the thermal post grade (0.14 s blend) and restores default cleanly on off and reset', () => {
    r.step(1 / FPS, true);
    expect(r.chips.thermal).toBe(true);
    expect(r.postGrades).toEqual([{ name: 'thermal', blendSeconds: 0.14 }]);
    expect(r.heldGrades).toEqual(['thermal']);

    // Staying on does not spam setGrade every frame
    r.step(1 / FPS);
    r.step(1 / FPS);
    expect(r.postGrades).toHaveLength(1);

    // Toggle off restores 'default'
    r.step(1 / FPS, true);
    expect(r.chips.thermal).toBe(false);
    expect(r.postGrades).toEqual([
      { name: 'thermal', blendSeconds: 0.14 },
      { name: 'default', blendSeconds: 0.14 },
    ]);
    expect(r.heldGrades).toEqual(['thermal', null]);

    // Toggle back on, then reset() restores 'default'
    r.postGrades.length = 0;
    r.heldGrades.length = 0;
    r.step(1 / FPS);
    r.step(1 / FPS, true);
    expect(r.chips.thermal).toBe(true);
    expect(r.postGrades).toEqual([{ name: 'thermal', blendSeconds: 0.14 }]);

    r.chips.reset();
    expect(r.chips.thermal).toBe(false);
    expect(r.postGrades).toEqual([
      { name: 'thermal', blendSeconds: 0.14 },
      { name: 'default', blendSeconds: 0.14 },
    ]);
    expect(r.heldGrades).toEqual(['thermal', null]);
  });

  it('highlights living enemies within 32 m with visibleFill > 0, fades smoothly over 26..32 m, and culls enemies at 45 m', () => {
    expect(THERMAL_RANGE).toBe(32);
    expect(THERMAL_FALLOFF_START).toBe(26);

    const closeMesh = new THREE.Object3D();
    const midMesh = new THREE.Object3D();
    const edgeMesh = new THREE.Object3D();
    const farMesh = new THREE.Object3D();
    r.enemies.push(
      { position: new THREE.Vector3(0, 0, -12), char: { mesh: closeMesh } },
      { position: new THREE.Vector3(0, 0, -28), char: { mesh: midMesh } },
      { position: new THREE.Vector3(0, 0, -31), char: { mesh: edgeMesh } },
      { position: new THREE.Vector3(0, 0, -45), char: { mesh: farMesh } },
    );

    r.step(1 / FPS, true);

    const closeBatch = r.highlights.find(h => h.meshes.includes(closeMesh));
    const midBatch = r.highlights.find(h => h.meshes.includes(midMesh));
    const edgeBatch = r.highlights.find(h => h.meshes.includes(edgeMesh));
    const farBatch = r.highlights.find(h => h.meshes.includes(farMesh));

    expect(closeBatch).toBeDefined();
    expect(closeBatch!.strength).toBe(1);
    expect(closeBatch!.visibleFill).toBeCloseTo(THERMAL.visibleFill, 3);
    expect(closeBatch!.visibleFill).toBeGreaterThan(0.8);

    expect(midBatch).toBeDefined();
    expect(midBatch!.strength).toBeGreaterThan(0.5);
    expect(midBatch!.strength).toBeLessThan(1);
    expect(midBatch!.visibleFill).toBeGreaterThan(0);

    expect(edgeBatch).toBeDefined();
    expect(edgeBatch!.strength).toBeGreaterThan(0);
    expect(edgeBatch!.strength).toBeLessThan(midBatch!.strength);
    expect(edgeBatch!.visibleFill).toBeGreaterThan(0);
    expect(edgeBatch!.visibleFill).toBeLessThan(midBatch!.visibleFill);

    expect(farBatch).toBeUndefined();
  });

  it('tracks cooling corpses after enemy:killed and fades them out after 20 s', () => {
    expect(THERMAL_CORPSE_COOL).toBe(20);

    const victim: TestEnemy = { position: new THREE.Vector3(0, 0, -10), char: { mesh: new THREE.Object3D() } };
    const gibbedVictim: TestEnemy = { position: new THREE.Vector3(0, 0, -8), char: { mesh: new THREE.Object3D() } };
    r.enemies.push(victim);

    // Turn thermal on
    r.step(1 / FPS, true);

    // Kill the victim and remove from alive list
    r.enemies.length = 0;
    r.ctx.events.emit('enemy:killed', { enemy: victim, gibbed: false, sliced: false } as never);
    r.ctx.events.emit('enemy:killed', { enemy: gibbedVictim, gibbed: true, sliced: false } as never);

    // Immediately after death: warm orange-red cooling highlight
    r.step(0.1);
    const freshBatch = r.highlights.find(h => h.meshes.includes(victim.char.mesh));
    expect(freshBatch).toBeDefined();
    expect(freshBatch!.color).toBe(THERMAL.corpseHotColor);
    expect(freshBatch!.strength).toBeGreaterThan(0.7);
    expect(freshBatch!.visibleFill).toBeGreaterThan(0.5);
    // Gibbed enemies leave no intact corpse
    expect(r.highlights.some(h => h.meshes.includes(gibbedVictim.char.mesh))).toBe(false);

    // Halfway through cooling (12 s total): dimmer cooler ember
    r.advance(12);
    const coolerBatch = r.highlights.find(h => h.meshes.includes(victim.char.mesh));
    expect(coolerBatch).toBeDefined();
    expect(coolerBatch!.color).toBe(THERMAL.corpseCoolColor);
    expect(coolerBatch!.strength).toBeLessThan(freshBatch!.strength);

    // Past 20 s: completely cooled and no longer highlighted
    r.advance(9);
    const expiredBatch = r.highlights.find(h => h.meshes.includes(victim.char.mesh));
    expect(expiredBatch).toBeUndefined();
  });

  it('highlights registered thermal sources within 32 m when thermal is active', () => {
    const bulb = new THREE.Object3D();
    bulb.position.set(0, 3, -10);
    const breaker = new THREE.Object3D();
    breaker.position.set(4, 1.5, -14);
    const darkBulb = new THREE.Object3D();
    darkBulb.position.set(0, 3, -5);
    darkBulb.visible = false;
    const farCamera = new THREE.Object3D();
    farCamera.position.set(0, 3, -45);

    r.chips.rack.setThermalSources(() => ({
      hot: [bulb, darkBulb],
      warm: [breaker, farCamera],
    }));

    // While thermal is OFF, sources are not highlighted
    r.step(1 / FPS);
    expect(r.highlights).toHaveLength(0);

    // Turn thermal ON
    r.step(1 / FPS, true);
    const hotBatch = r.highlights.find(h => h.meshes.includes(bulb));
    const warmBatch = r.highlights.find(h => h.meshes.includes(breaker));

    expect(hotBatch).toBeDefined();
    expect(hotBatch!.color).toBe(THERMAL.sourceHotColor);
    expect(hotBatch!.visibleFill).toBeGreaterThan(0);
    expect(hotBatch!.meshes).not.toContain(darkBulb);

    expect(warmBatch).toBeDefined();
    expect(warmBatch!.color).toBe(THERMAL.sourceWarmColor);
    expect(warmBatch!.visibleFill).toBeGreaterThan(0);
    expect(warmBatch!.meshes).not.toContain(farCamera);

    // Clearing provider stops highlighting sources
    r.chips.rack.setThermalSources(null);
    r.step(1 / FPS);
    expect(r.highlights).toHaveLength(0);
  });

  it('supports up to 8 simultaneous XRay batches and binds uVisibleFill per batch', () => {
    const xray = new XRay();
    const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 100);
    const depth = new THREE.Texture();

    const meshes = Array.from({ length: 8 }, () => new THREE.Object3D());
    // Batch 0: default visibleFill (Sonar / gunner compatibility)
    xray.add([meshes[0]!], '#00ffff', 1);
    // Batches 1..7: thermal heat tiers with explicit visibleFill
    for (let i = 1; i < 8; i++) {
      xray.add([meshes[i]!], '#ffaa33', 0.5 + i * 0.05, i * 0.1);
    }

    const fills: number[] = [];
    while (xray.next(depth, cam)) {
      fills.push(xray.material.uniforms.uVisibleFill!.value as number);
    }
    expect(fills).toHaveLength(8);
    expect(fills[0]).toBe(0);
    expect(fills[7]).toBeCloseTo(0.7, 5);
  });

  it('tunes the thermal post grade with cool lifted shadows for dark-room navigability', () => {
    const g = GRADES.thermal;
    // Cool midnight-indigo shadow lift (blue > green > red) so pitch-black rooms stay navigable
    expect(g.lift[2]).toBeGreaterThan(g.lift[1]);
    expect(g.lift[1]).toBeGreaterThan(g.lift[0]);
    expect(g.shadowTint[2]).toBeGreaterThan(g.shadowTint[0]);
    // Warm highlights so white-hot / amber bodies pop against cold rooms
    expect(g.highlightTint[0]).toBeGreaterThan(g.highlightTint[2]);
    expect(g.isolate).toBeGreaterThan(0.7);
  });
});
