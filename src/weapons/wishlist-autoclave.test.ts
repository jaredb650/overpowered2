import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { lookup } from '../audio/catalog';
import { CG, type Ctx, type DamageInfo, type LoopHandle } from '../core/contracts';
import type { EnemyInstance } from '../core/gameplay';
import { MICROWAVE, Microwave } from './microwave';
import { WEAPONS } from './data';
import { autoclaveDef } from './viewmodels/models/autoclave';
import { HANDS } from './viewmodels/poses';
import { Kit as VmKit } from './viewmodels/kit/kit';
import type { VmMaterials } from './viewmodels/kit/materials';
import type { Anim } from './viewmodels/def';

interface MockEnemy extends EnemyInstance {
  stagger: number;
  shaken: number;
  pressure: number;
  pace: number;
  attack: object | null;
  attackPhase: string;
  attackReadyAt: number;
  flinchCalls: number;
  playActions: string[];
  burns: number[];
}

function makeEnemy(uid: number, pos: [number, number, number], opts: Partial<{ armor: number; health: number; isBoss: boolean }> = {}): MockEnemy {
  const root = new THREE.Group();
  const center = new THREE.Vector3(pos[0], pos[1], pos[2]);
  const flinchCalls = { n: 0 };
  const playActions: string[] = [];
  const burns: number[] = [];
  let burnVal = 0;

  const enemy: MockEnemy = {
    uid,
    id: opts.isBoss ? 'juggernaut' : opts.armor ? 'brute' : 'trooper',
    char: {
      archetype: 'trooper',
      rig: { bones: [{ name: 'pelvis', region: 'pelvis' }, { name: 'chest', region: 'chest' }] } as unknown as EnemyInstance['char']['rig'],
      root,
      bones: [],
      mesh: new THREE.SkinnedMesh(),
      anim: {
        setLocomotion() {},
        play(action: string) {
          playActions.push(action);
          return 0.4;
        },
        flinch() {
          flinchCalls.n += 1;
        },
        update() {},
      },
      severed: new Set(),
      hideLimb() {},
      addWound() {},
      wound() {},
      fracture: () => false,
      isFractured: () => false,
      skinMaterial: new THREE.MeshBasicMaterial(),
      stress: new Float32Array(4),
      setBloodiness() {},
      setBurn(v: number) {
        burnVal = v;
        burns.push(v);
      },
      get burn() {
        return burnVal;
      },
      setEmber() {},
      hitFlash() {},
      attachProp() {},
      spawnSevered: () => ({} as never),
      bakePose: () => new THREE.BufferGeometry(),
      release() {},
    } as unknown as EnemyInstance['char'],
    position: center.clone(),
    velocity: new THREE.Vector3(),
    center,
    yaw: 0,
    health: opts.health ?? 120,
    maxHealth: opts.health ?? 120,
    armor: opts.armor ?? 0,
    alive: true,
    score: 100,
    isBoss: opts.isBoss ?? false,
    frozen: 0,
    burning: 0,
    machine: false,
    stagger: 0,
    shaken: 0,
    pressure: 0,
    pace: 1,
    attack: { id: 'rifle' },
    attackPhase: 'fire',
    attackReadyAt: 0,
    get flinchCalls() {
      return flinchCalls.n;
    },
    set flinchCalls(v: number) {
      flinchCalls.n = v;
    },
    playActions,
    burns,
  };
  return enemy;
}

function makeHarness(enemies: MockEnemy[], wallDist: number | null = null) {
  const damages: { enemy: MockEnemy; info: DamageInfo; scaleAtCall: THREE.Vector3 }[] = [];
  const shimmers: { pos: THREE.Vector3; radius: number; seconds: number }[] = [];
  const smokes: { pos: THREE.Vector3; color: THREE.ColorRepresentation | undefined }[] = [];
  const bloodMists: THREE.Vector3[] = [];
  const beams = vi.fn();
  const lightFlashes = vi.fn();
  const soundsPlayed: string[] = [];
  const markers: string[] = [];
  const loopPitches: number[] = [];
  let loopStopped = false;
  let loopAlive = false;
  let loopStartedId: string | null = null;

  const loopHandle: LoopHandle = {
    get alive() {
      return loopAlive;
    },
    setVolume() {},
    setPitch(p: number) {
      loopPitches.push(p);
    },
    setPosition() {},
    stop() {
      loopAlive = false;
      loopStopped = true;
    },
  };

  const ctx = {
    time: { elapsed: 10, dt: 1 / 60 },
    enemies: {
      query(_center: THREE.Vector3, _radius: number, out: EnemyInstance[]) {
        out.length = 0;
        for (const e of enemies) out.push(e);
        return out.length;
      },
      applyDamage(e: EnemyInstance, info: DamageInfo) {
        const me = e as MockEnemy;
        const cloned: DamageInfo = {
          ...info,
          point: info.point.clone(),
          dir: info.dir.clone(),
        };
        damages.push({ enemy: me, info: cloned, scaleAtCall: me.char.root.scale.clone() });
        me.health -= info.amount;
        const killed = me.health <= 0;
        if (killed) me.alive = false;
        return { dealt: info.amount, killed, headshot: false, severed: [], blocked: false };
      },
    },
    physics: {
      raycast(_origin: THREE.Vector3, _dir: THREE.Vector3, maxDist: number, mask?: number) {
        if (wallDist !== null && (mask === undefined || (mask & CG.World) !== 0) && wallDist <= maxDist) {
          return {
            point: new THREE.Vector3(),
            normal: new THREE.Vector3(0, 0, 1),
            distance: wallDist,
            surface: 'concrete',
            collider: null,
          };
        }
        return null;
      },
      raycastInto(_origin: THREE.Vector3, _dir: THREE.Vector3, maxDist: number, mask: number, out: { distance: number }) {
        if (wallDist !== null && (mask & CG.World) !== 0 && wallDist <= maxDist) {
          out.distance = wallDist;
          return true;
        }
        return false;
      },
    },
    fx: {
      heatShimmer(pos: THREE.Vector3, radius: number, seconds: number) {
        shimmers.push({ pos: pos.clone(), radius, seconds });
      },
      smoke(pos: THREE.Vector3, color?: THREE.ColorRepresentation) {
        smokes.push({ pos: pos.clone(), color });
      },
      smokeWisp() {},
      bloodMist(pos: THREE.Vector3) {
        bloodMists.push(pos.clone());
      },
      beam: beams,
    },
    render: {
      lights: {
        flash: lightFlashes,
      },
    },
    audio: {
      play(id: string) {
        soundsPlayed.push(id);
      },
      startLoop(id: string, opts?: { pitch?: number }) {
        loopStartedId = id;
        loopAlive = true;
        loopStopped = false;
        if (opts?.pitch !== undefined) loopPitches.push(opts.pitch);
        return loopHandle;
      },
    },
    hud: {
      hitMarker(kind: string) {
        markers.push(kind);
      },
    },
    camera: {
      addTrauma() {},
    },
  } as unknown as Ctx;

  return {
    ctx,
    damages,
    shimmers,
    smokes,
    bloodMists,
    beams,
    lightFlashes,
    soundsPlayed,
    markers,
    loopPitches,
    get loopStartedId() {
      return loopStartedId;
    },
    get loopStopped() {
      return loopStopped;
    },
    get loopAlive() {
      return loopAlive;
    },
  };
}

describe('Autoclave hero viewmodel (Lane I)', () => {
  let kit: VmKit;

  beforeAll(() => {
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 180,
        height: 104,
        getContext: () => ({
          createRadialGradient: () => ({ addColorStop() {} }),
          fillRect() {},
          fillText() {},
          fillStyle: '',
          font: '',
          textBaseline: 'top',
        }),
      }),
    });
    const material = new THREE.MeshStandardMaterial();
    kit = new VmKit({
      hard: material,
      glass: material,
      decal: material,
      decalRegions: new Proxy({}, { get: () => [0, 0, 1, 1] }),
      glow(color: number, intensity: number) {
        const glow = new THREE.MeshBasicMaterial({ color });
        glow.color.multiplyScalar(intensity);
        glow.userData.base = glow.color.clone();
        return glow;
      },
    } as unknown as VmMaterials);
  });

  afterAll(() => vi.unstubAllGlobals());

  it('builds with required sockets, parts, screen, HANDS.support, and zero roll/twist reload', () => {
    const def = autoclaveDef(kit);
    expect(def.id).toBe('autoclave');
    expect(def.left?.pose).toBe(HANDS.support);
    expect(def.right?.pose).toBe(HANDS.grip);
    expect(def.model.sockets.muzzle).toBeDefined();
    expect(def.model.sockets.gripR).toBeDefined();
    expect(def.model.sockets.gripL).toBeDefined();
    expect(def.model.sockets.cellHold).toBeDefined();
    expect(def.model.sockets.boltHold).toBeDefined();
    expect(def.model.parts.cell).toBeDefined();
    expect(def.model.parts.bolt).toBeDefined();
    expect(def.model.parts.needle).toBeDefined();
    expect(def.model.parts.trigger).toBeDefined();
    expect(def.model.screens.ammo).toBeDefined();

    // Verify reload and draw keep gunR.z === 0 and gunR.y === 0 (ZERO roll or twist!)
    // and cell never twists/rolls while detaching & re-seating.
    const glowLevels: Record<string, number> = {};
    const makeAnim = (overrides: Partial<Anim> = {}): Anim => ({
      time: 1.5,
      dt: 1 / 60,
      sinceFire: 10,
      strength: 1,
      heat: 0,
      charge: 0,
      mag: 90,
      magSize: WEAPONS.autoclave.magSize,
      reload: -1,
      draw: 1,
      gunP: new THREE.Vector3(),
      gunR: new THREE.Vector3(),
      parts: def.model.parts,
      model: def.model,
      glow(name: string, level: number) {
        glowLevels[name] = level;
      },
      left: { fingerRate: 24, to() {}, shape() {} } as unknown as Anim['left'],
      right: { fingerRate: 24, to() {}, shape() {} } as unknown as Anim['right'],
      ...overrides,
    }) as Anim;

    // At rest: coil glow is off (NOT a glowing laser rifle).
    def.model.resetParts();
    def.animate(makeAnim({ sinceFire: 10, heat: 0 }));
    expect(glowLevels.coil).toBe(0);

    // While firing: warm magnetron coil indicator lights up, still zero roll/twist.
    def.model.resetParts();
    const fireAnim = makeAnim({ sinceFire: 0.01, heat: 0.5 });
    def.animate(fireAnim);
    expect(glowLevels.coil).toBeGreaterThan(0.5);
    expect(fireAnim.gunR.z).toBe(0);
    expect(fireAnim.gunR.y).toBe(0);

    // Full reload sweep: strictly zero roll & twist on weapon AND cell.
    def.model.resetParts();
    const restBoltZ = def.model.parts.bolt!.position.z;
    let minCellY = Infinity;
    let maxBoltZ = -Infinity;
    for (let i = 0; i <= 40; i++) {
      const p = i / 40;
      def.model.resetParts();
      const a = makeAnim({ reload: p });
      def.animate(a);
      expect(a.gunR.z).toBe(0);
      expect(a.gunR.y).toBe(0);
      const cell = def.model.parts.cell!;
      expect(Math.abs(cell.rotation.x)).toBe(0);
      expect(Math.abs(cell.rotation.y)).toBe(0);
      expect(Math.abs(cell.rotation.z)).toBe(0);
      if (cell.position.y < minCellY) minCellY = cell.position.y;
      const bolt = def.model.parts.bolt!;
      if (bolt.position.z > maxBoltZ) maxBoltZ = bolt.position.z;
    }
    expect(minCellY).toBeLessThan(-0.2);
    expect(maxBoltZ - restBoltZ).toBeGreaterThan(0.025);

    // Draw sweep: strictly zero roll & twist.
    for (let i = 0; i <= 10; i++) {
      def.model.resetParts();
      const a = makeAnim({ draw: i / 10 });
      def.animate(a);
      expect(a.gunR.z).toBe(0);
      expect(a.gunR.y).toBe(0);
    }

    // Screen readout draws cleanly.
    expect(() => def.readout?.(makeAnim({ mag: 48 }))).not.toThrow();
  });
});

describe('Microwave boiling, armour bypass, stages, swell, POP, and Q8 shimmer (Lane I)', () => {
  const eye = new THREE.Vector3(0, 1.6, 0);
  const forward = new THREE.Vector3(0, 0, -1);
  const muzzle = new THREE.Vector3(0.2, 1.45, -0.5);

  it('uses only registered catalog sound IDs', () => {
    for (const id of Object.values(MICROWAVE.sounds)) {
      expect(lookup(id), `sound id ${id} must exist in src/audio/catalog.ts`).toBeDefined();
    }
  });

  it('heats 2-3 enemies simultaneously inside the narrow cone and ignores targets outside angle or range', () => {
    const e1 = makeEnemy(1, [0, 1.6, -8]); // dead center
    const e2 = makeEnemy(2, [1.0, 1.6, -9]); // ~6.3° inside 10° cone
    const e3 = makeEnemy(3, [-1.1, 1.6, -10]); // ~6.3° inside 10° cone
    const outsideAngle = makeEnemy(4, [4.0, 1.6, -8]); // ~26.5° outside 10° cone
    const outsideRange = makeEnemy(5, [0, 1.6, -21]); // beyond 18 m range

    const h = makeHarness([e1, e2, e3, outsideAngle, outsideRange]);
    const mw = new Microwave(h.ctx);

    const active = mw.update(0.5, true, eye, forward, muzzle);
    expect(active).toBe(true);
    expect(mw.heatOf(1)).toBeCloseTo(0.5 * MICROWAVE.heatRate, 4);
    expect(mw.heatOf(2)).toBeCloseTo(0.5 * MICROWAVE.heatRate, 4);
    expect(mw.heatOf(3)).toBeCloseTo(0.5 * MICROWAVE.heatRate, 4);
    expect(mw.heatOf(4)).toBe(0);
    expect(mw.heatOf(5)).toBe(0);
  });

  it('blocks microwave radiation behind solid world walls', () => {
    const behindWall = makeEnemy(1, [0, 1.6, -10]);
    const h = makeHarness([behindWall], 5); // wall at 5 m in front of enemy at 10 m
    const mw = new Microwave(h.ctx);

    mw.update(1.0, true, eye, forward, muzzle);
    expect(mw.heatOf(1)).toBe(0);
  });

  it('bypasses plate armour completely: armoured enemy heats at identical rate and pops through armour', () => {
    const unarmoured = makeEnemy(1, [-0.5, 1.6, -8], { armor: 0, health: 100 });
    const armoured = makeEnemy(2, [0.5, 1.6, -8], { armor: 300, health: 220 });
    const h = makeHarness([unarmoured, armoured]);
    const mw = new Microwave(h.ctx);

    // 1.1 s is half of 2.2 s -> ~0.5 heat on both regardless of armor: 300.
    mw.update(1.1, true, eye, forward, muzzle);
    expect(mw.heatOf(2)).toBeCloseTo(mw.heatOf(1), 5);
    expect(mw.heatOf(2)).toBeGreaterThan(0.45);

    // Finish boiling to 1.0 -> both pop lethally with armour-bypassing gib damage.
    for (let i = 0; i < 12; i++) mw.update(0.1, true, eye, forward, muzzle);
    expect(unarmoured.alive).toBe(false);
    expect(armoured.alive).toBe(false);
    const armouredHit = h.damages.find((d) => d.enemy.uid === 2);
    expect(armouredHit).toBeDefined();
    expect(armouredHit!.info.type).toBe('true');
    expect(armouredHit!.info.pierces).toBe(true);
    expect(armouredHit!.info.armorPiercing).toBe(true);
    expect(armouredHit!.info.gib).toBe(true);
    expect(armouredHit!.info.source).toBe('autoclave');
  });

  it('drives Stage 1 (stagger + steam + char), Stage 2 (interrupt + scream + swell), cool-down scale restore, and Stage 3 POP', () => {
    const e = makeEnemy(10, [0, 1.6, -8], { health: 140 });
    const h = makeHarness([e]);
    const mw = new Microwave(h.ctx);

    // Advance into Stage 1 (>= 0.33 -> ~0.85 s).
    for (let i = 0; i < 9; i++) mw.update(0.1, true, eye, forward, muzzle);
    expect(mw.heatOf(10)).toBeGreaterThanOrEqual(MICROWAVE.stage1);
    expect(mw.heatOf(10)).toBeLessThan(MICROWAVE.stage2);
    expect(e.flinchCalls).toBeGreaterThanOrEqual(1);
    expect(e.playActions).toContain('stagger');
    expect(e.stagger).toBeGreaterThan(0);
    expect(h.smokes.length).toBeGreaterThan(0);
    expect(h.soundsPlayed).toContain(MICROWAVE.sounds.stage1Pain);
    expect(e.burns.length).toBeGreaterThan(0);
    expect(e.char.root.scale.x).toBe(1);

    // Advance into Stage 2 (>= 0.67 -> ~1.75 s total).
    for (let i = 0; i < 9; i++) mw.update(0.1, true, eye, forward, muzzle);
    expect(mw.heatOf(10)).toBeGreaterThanOrEqual(MICROWAVE.stage2);
    expect(mw.heatOf(10)).toBeLessThan(1);
    expect(e.attackPhase).toBe('idle');
    expect(e.attack).toBeNull();
    expect(h.soundsPlayed).toContain(MICROWAVE.sounds.stage2Scream);
    expect(h.soundsPlayed).toContain(MICROWAVE.sounds.boilHiss);
    expect(e.char.root.scale.x).toBeGreaterThan(1.02);
    expect(e.char.root.scale.z).toBeGreaterThan(1.02);

    // Cool down below Stage 2 -> swell scale MUST restore cleanly to (1, 1, 1)!
    for (let i = 0; i < 10; i++) mw.update(0.1, false, eye, forward, muzzle);
    expect(mw.heatOf(10)).toBeLessThan(MICROWAVE.stage2);
    expect(e.char.root.scale.x).toBe(1);
    expect(e.char.root.scale.y).toBe(1);
    expect(e.char.root.scale.z).toBe(1);

    // Re-heat all the way to Stage 3 POP (>= 1.0).
    for (let i = 0; i < 20; i++) {
      if (!e.alive) break;
      mw.update(0.1, true, eye, forward, muzzle);
    }
    expect(e.alive).toBe(false);
    expect(h.damages.length).toBe(1);
    // Scale MUST already be restored to (1,1,1) BEFORE applyDamage/gib is invoked!
    expect(h.damages[0]!.scaleAtCall.x).toBe(1);
    expect(h.damages[0]!.scaleAtCall.y).toBe(1);
    expect(h.damages[0]!.scaleAtCall.z).toBe(1);
    expect(h.bloodMists.length).toBeGreaterThanOrEqual(1);
    expect(h.soundsPlayed).toContain(MICROWAVE.sounds.pop);
    expect(h.soundsPlayed).toContain(MICROWAVE.sounds.popWet);
    expect(h.markers).toContain('kill');
    expect(mw.heatOf(10)).toBe(0);
  });

  it('heats bosses at reduced 0.35x rate and deals massive internal burst damage without instant gib if HP remains', () => {
    const boss = makeEnemy(99, [0, 1.8, -9], { isBoss: true, health: 2000, armor: 500 });
    const h = makeHarness([boss]);
    const mw = new Microwave(h.ctx);

    mw.update(1.0, true, eye, forward, muzzle);
    expect(mw.heatOf(99)).toBeCloseTo(MICROWAVE.heatRate * MICROWAVE.bossHeatMult, 4);

    // Sustain until boss reaches 1.0 (~6.3 s).
    for (let i = 0; i < 60; i++) {
      mw.update(0.1, true, eye, forward, muzzle);
      if (h.damages.length > 0) break;
    }
    expect(h.damages.length).toBe(1);
    expect(h.damages[0]!.info.amount).toBe(MICROWAVE.bossPopDamage);
    expect(h.damages[0]!.info.gib).toBe(false);
    expect(boss.alive).toBe(true);
    expect(boss.health).toBe(2000 - MICROWAVE.bossPopDamage);
    // Heat resets to 0 after internal burst so boss can be boiled again.
    expect(mw.heatOf(99)).toBe(0);
    expect(boss.char.root.scale.x).toBe(1);
  });

  it('emits faint heat shimmer ONLY (Q8: NO visible beam, NO dynamic light) and drives rising magnetron hum loop', () => {
    const e = makeEnemy(5, [0, 1.6, -8]);
    const h = makeHarness([e]);
    const mw = new Microwave(h.ctx);

    mw.update(0.1, true, eye, forward, muzzle);
    mw.update(0.1, true, eye, forward, muzzle);
    mw.emitShimmer(muzzle, forward, 0.1);

    expect(h.shimmers.length).toBeGreaterThan(0);
    expect(h.beams).not.toHaveBeenCalled();
    expect(h.lightFlashes).not.toHaveBeenCalled();

    expect(h.loopStartedId).toBe(MICROWAVE.sounds.humLoop);
    expect(h.loopAlive).toBe(true);
    expect(h.loopPitches.length).toBeGreaterThanOrEqual(2);
    expect(h.loopPitches[h.loopPitches.length - 1]!).toBeGreaterThanOrEqual(h.loopPitches[0]!);

    // Stopping fire stops the hum loop cleanly.
    mw.update(0.1, false, eye, forward, muzzle);
    expect(h.loopStopped).toBe(true);

    // Reset restores any swelled enemy and clears state cleanly.
    for (let i = 0; i < 18; i++) mw.update(0.1, true, eye, forward, muzzle);
    expect(e.char.root.scale.x).toBeGreaterThan(1);
    mw.reset();
    expect(e.char.root.scale.x).toBe(1);
    expect(mw.heatOf(5)).toBe(0);
  });
});
