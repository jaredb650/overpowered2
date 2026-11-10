/**
 * Dead weight, on real Rapier ragdolls and the real animator. A body that sits on its heels, props itself up on its knees,
 * stirs after a headshot, stumbles on with its head gone, or skates on its feet while it dies fails here.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { archetypeById, rigFor } from '../characters/archetypes';
import { HumanoidAnimator } from '../characters/animation/HumanoidAnimator';
import { HumanoidBone as B } from '../characters/rig';
import { Physics } from '../physics/Physics';
import { makeCtx } from '../sandbox/harness';
import type { Ctx, DamageInfo } from '../core/contracts';
import { createGoreSystem, type Gore } from './index';
import { RagTuning, type Rag } from './rag';
import { TestDummy } from './testDummy';

const trooper = archetypeById('trooper');
const rig = rigFor(trooper);
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const at = (c: TestDummy, bone: number) => new THREE.Vector3().setFromMatrixPosition(c.bones[bone]!.matrixWorld);
const HEADINGS = [0, 1.05, 2.1, 3.15, 4.2, 5.25];

let physics: Physics;
let ctx: Ctx;
let gore: Gore;
const scene = new THREE.Scene();

beforeAll(async () => {
  physics = await Physics.create();
  ctx = makeCtx({
    physics,
    render: { scene, decals: { add() {}, splat() {}, clear() {} } } as unknown as Ctx['render'],
  });
  gore = createGoreSystem(ctx);
  gore.init();
  physics.addStaticBox(v(0, -0.5, 0), v(60, 0.5, 60), null, 'concrete');
  physics.flushQueries();
});

/** A trooper standing on the real animator, facing `yaw`. */
function spawnLiving(yaw = 0): TestDummy {
  const c = new TestDummy(rig);
  c.root.rotation.y = yaw;
  scene.add(c.root);
  c.root.updateMatrixWorld(true);
  const anim = new HumanoidAnimator(c.bones, rig, trooper, c.root, c.severed, b => (c as unknown as { hidden: Uint8Array }).hidden[b] === 1);
  (c as { anim: unknown }).anim = anim;
  for (let i = 0; i < 30; i++) {
    anim.setLocomotion({ speed: 0, moveX: 0, moveZ: 1, aimYaw: 0, aimPitch: 0, grounded: true });
    anim.update(1 / 60, 0);
  }
  c.root.updateMatrixWorld(true);
  return c;
}

function frame(): void {
  ctx.time.tick(1 / 60);
  physics.step(ctx.time.dt);
  gore.update();
}

const ragOf = (c: TestDummy): Rag => (gore as unknown as { owned: Map<TestDummy, { rag: Rag }> }).owned.get(c)!.rag;

/** Shot from in front: bodies face +Z at yaw 0, and the round travels against it. */
const shot = (c: TestDummy, bone: number, amount: number, force: number): DamageInfo => {
  const fwd = v(Math.sin(c.root.rotation.y), 0, Math.cos(c.root.rotation.y));
  return { amount, type: 'bullet', point: at(c, bone).addScaledVector(fwd, 0.1), dir: fwd.clone().negate(), force, source: 'test', bone, region: bone === B.head ? 'head' : 'chest' };
};

type Death = 'drop' | 'headshot' | 'judge';
function kill(kind: Death, c: TestDummy): void {
  if (kind === 'drop') gore.ragdoll(c);
  else if (kind === 'headshot') gore.headshot(c, shot(c, B.head, 50, 20));
  else {
    const d = shot(c, B.chest, 120, 40);
    gore.ragdoll(c, { impulses: [{ bone: B.chest, point: d.point, impulse: d.dir.clone().multiplyScalar(40).add(v(0, 6, 0)) }] });
  }
}

/**
 * Sitting on its heels: hips low while a knee is still high. On the whole sole a dead shin stood up by itself like a boot,
 * and bodies squatted there for 0.4 to 1.1 s before they went over. `tempo` stretches the times by the tempo dial's pace,
 * and the mean is over `rounds` of the six headings.
 */
function heels(tempo = 1, rounds = 1): void {
  const bodies = rounds * HEADINGS.length;
  for (const kind of ['drop', 'headshot', 'judge'] as const) {
    let onHeels = 0;
    let kneesDown = 0;
    for (let i = 0; i < bodies; i++) {
      const yaw = HEADINGS[i % HEADINGS.length]!;
      gore.clear();
      const c = spawnLiving(yaw);
      const hips0 = at(c, B.hips).y;
      kill(kind, c);
      let down = -1;
      for (let f = 1; f <= 120; f++) {
        frame();
        const knee = Math.max(at(c, B.shinL).y, at(c, B.shinR).y);
        if (at(c, B.hips).y < 0.3 * hips0 && knee > 0.33 * hips0) onHeels += 1 / 60;
        if (down < 0 && knee < 0.2 * hips0) down = f / 60;
      }
      kneesDown += down < 0 ? 2 : down;
    }
    expect(onHeels / bodies, kind).toBeLessThan(0.15 * tempo);
    expect(kneesDown / bodies, kind).toBeLessThan(0.6 * tempo);
  }
  gore.clear();
}

describe('dead weight', () => {
  it('a dead body does not sit on its heels', () => {
    heels();
  });

  it('a dead body lies flat', () => {
    // Once at rest it lies on the floor: not propped on its knees, not sitting, not kneeling. Not at length: it ends folded
    // over its knees, head to foot 0.75 m on a Trooper against 0.96 before, and no knee stop tried laid it out longer
    // (gore.md, Known limitations).
    for (const kind of ['drop', 'headshot', 'judge'] as const) {
      for (const yaw of HEADINGS.slice(0, 3)) {
        gore.clear();
        const c = spawnLiving(yaw);
        kill(kind, c);
        for (let f = 0; f < 60 * 8 && ragOf(c).active; f++) frame();
        expect(ragOf(c).active, `${kind} ${yaw} came to rest`).toBe(false);
        expect(at(c, B.hips).y, `${kind} ${yaw} hips`).toBeLessThan(0.3);
        expect(Math.max(at(c, B.shinL).y, at(c, B.shinR).y), `${kind} ${yaw} knees`).toBeLessThan(0.25);
        expect(at(c, B.head).y, `${kind} ${yaw} head`).toBeLessThan(0.35);
      }
    }
    gore.clear();
  });

  it('a lethal headshot lies still once down', () => {
    // Down in 0.3 to 0.4 s. From 1 s on, twitching lifted the hips of a body that had landed by 0.1 to 0.4 m, and moved
    // its head, hands and feet 2 to 4.6 m between them, for 3 to 4 s. Counted from 1 s, as the weight probe does: from
    // the moment the hips first pass 0.4 m it would count the body settling as it lands, 0.03 to 0.12 m.
    for (const yaw of HEADINGS.slice(0, 3)) {
      gore.clear();
      const c = spawnLiving(yaw);
      kill('headshot', c);
      expect(ragOf(c).muscle!.twitch).toBe(0);
      const parts = [B.hips, B.head, B.handL, B.handR, B.footL, B.footR];
      let last = parts.map(b => at(c, b));
      let high = 0;
      let motion = 0;
      for (let f = 1; f <= 60 * 4; f++) {
        frame();
        const now = parts.map(b => at(c, b));
        if (f > 60) {
          high = Math.max(high, now[0]!.y);
          now.forEach((p, i) => (motion += p.distanceTo(last[i]!)));
        }
        last = now;
      }
      expect(at(c, B.hips).y).toBeLessThan(0.3);
      expect(high - at(c, B.hips).y).toBeLessThan(0.03);
      expect(motion).toBeLessThan(0.5);
    }
    gore.clear();
  });

  it('a head round ends a collapse on that frame', () => {
    gore.clear();
    const c = spawnLiving();
    gore.collapse(c, { duration: 1.7 });
    for (let f = 0; f < 18; f++) frame();
    const rag = ragOf(c);
    expect(rag.muscle!.collapse).not.toBeNull();
    // From above and in front, so nothing else on a body bent by its own weight is in the way.
    const head = at(c, B.head);
    const from = head.clone().add(v(0, 2, 1.2));
    const hit = gore.raycastCorpses(from, head.clone().sub(from).normalize(), 4);
    expect(hit?.region).toBe('head');
    gore.damageCorpse(hit!, { ...shot(c, B.head, 25, 20), point: hit!.point });
    // The same call: no stumble left, every muscle gone.
    expect(rag.muscle!.collapse).toBeNull();
    expect(rag.slack).toBe(true);
    expect(gore.stats().collapses).toBe(0);
    let falling = 0;
    for (let f = 0; f < 8; f++) {
      frame();
      falling = Math.min(falling, rag.parts[0]!.body.linvel().y);
    }
    expect(falling).toBeLessThan(-1);
    gore.clear();
  });

  it('legs keep their gravity during a collapse', () => {
    // Feet need weight on the floor for friction, now on a ball at the heel. One body facing one way does not show it, so
    // three rounds of six, and the median, because now and then the death stumble lurches a whole body 0.3 to 0.6 m
    // whatever its feet do. The most either foot got from where it stood in the first 0.6 s: a median of 0.07 m, and 0.28
    // to 0.43 m with the legs' gravity cut like the arms'.
    const slides: number[] = [];
    for (let round = 0; round < 3; round++) {
      for (const yaw of HEADINGS) {
        gore.clear();
        const c = spawnLiving(yaw);
        const feet = [at(c, B.footL), at(c, B.footR)];
        gore.collapse(c, { duration: 1.7 });
        let most = 0;
        for (let f = 0; f < 36; f++) {
          frame();
          [B.footL, B.footR].forEach((bone, i) => {
            const now = at(c, bone);
            most = Math.max(most, Math.hypot(now.x - feet[i]!.x, now.z - feet[i]!.z));
          });
        }
        slides.push(most);
      }
    }
    slides.sort((a, b) => a - b);
    expect((slides[8]! + slides[9]!) / 2).toBeLessThan(0.16);
    gore.clear();
  });

  // Last, so the tests above meet the same bodies as before the dial. A fall under less gravity takes longer by the square
  // root, and so may this. With rounds at full speed and friction raised to hold grip, Judge kills sat on their heels 0.3
  // to 0.6 s on average at 0.6. Five rounds, because now and then a dropped body squats for a second, at 1 as often: in
  // twelve rounds of six at each dial, one round in twelve went over the line at 1, and three rounds in a row came to 0.15.
  it.each([0.75, 0.6])('a dead body does not sit on its heels on the tempo dial, %s', dial => {
    const was = RagTuning.gravityScale;
    RagTuning.gravityScale = dial;
    try {
      heels(1 / Math.sqrt(dial), 5);
    } finally {
      RagTuning.gravityScale = was;
    }
  });
});
