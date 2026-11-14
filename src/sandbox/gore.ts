/**
 * Gore test room. A row of characters and scripted scenarios at /?sandbox=gore&scenario=<name>.
 *
 *   scenario   headshot | limbs | crawl | explosion | slice | ragdoll | shootcorpse | stairs | stress | rigs | idle
 *              side by side, hard limits on the left and muscles on the right, under identical input:
 *              limit | zerog | fall | stairsab | blast | lineup
 *              collapse: dropped, collapsing, collapsing on the move. twitch: still on the left, twitching on the right
 *              weight: dropped, headshot, SMG collapse, Judge, in profile. Add weight=0 for the bodies before the weight pass
 *              knock: knocked over alive and back up: a body check, a head hit that knocks it cold, a blast at 3 m
 *   arch       archetype to spawn, default husk. dummy=1 uses the capsule TestDummy instead.
 *   cam        x,y,z,tx,ty,tz camera override.
 *   q          render quality preset.
 *   hold       1 starts paused at frame 0, so a contact sheet is exact however long the page took to load.
 *   muscles    0 turns the muscle layer off everywhere, in any scenario.
 *   weight     0 puts back the bodies from before the weight pass, in any scenario and in the game. The collapse's eased
 *              stagger and topple and far bodies' true seed speed stay on: they are fixes, not a look.
 *   raggrav    0.5..1, the tempo dial: the share of world gravity bodies fall under, in any scenario and in the game.
 *              Throws are slowed by its square root, so they land as far. Left out it is 1. Chunks keep world gravity.
 *   mass       0 puts back hits from before they knew the mass of what they hit, in any scenario and in the game: a round's
 *              jolt and a blast's spin as big on a Juggernaut as on a Trooper, 9 m/s from one round on a limb, the bigger
 *              living flinch on springs that rang, and a ragdoll budget that froze the oldest body however fresh or fast.
 *   knock      0 puts back knockdowns from before they could be run over, in any scenario and in the game: running into a
 *              body only staggers it, only a shotgun or a heavy round to the head floors it and nothing knocks it cold, a
 *              braced hand holds stiff, the arms carry their own weight in a fall, and a thrown body's hands leave its face
 *              after 0.2 s.
 *
 * Time is fixed at 1/60 per frame, so a scenario plays the same every run. window.__gore gives a capture
 * script frame-exact control: hold(), step(n) and sheet(), which draws a contact sheet over the page.
 */
import * as THREE from 'three';
import { createRenderSystem, type Renderer } from '../render';
import { Physics } from '../physics/Physics';
import { createFx } from '../fx';
import { createCharacterLibrary } from '../characters';
import { createGoreSystem, type Gore } from '../gore';
import { TestDummy } from '../gore/testDummy';
import { rigInfo } from '../gore/rigInfo';
import { humanoidRig, HumanoidBone as B, type GoreRegion } from '../characters/rig';
import { makeCtx } from './harness';
import type {
  BakedLight, CapsuleHit, CharacterInstance, Ctx, DamageInfo, DamageType, FxSystem, SurfaceKind,
} from '../core/contracts';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

const LIGHTS: BakedLight[] = [
  { position: v(0, 6, 5), color: 0xdfe6ff, intensity: 190, radius: 34 },
  { position: v(-11, 6, 5), color: 0xb8ccff, intensity: 110, radius: 26 },
  { position: v(11, 6, 5), color: 0xb8ccff, intensity: 110, radius: 26 },
];

function buildRoom(render: Renderer, physics: Physics): void {
  const unit = new THREE.BoxGeometry(1, 1, 1);
  type Mat = Parameters<Renderer['materials']['world']>[0];
  const add = (c: [number, number, number], h: [number, number, number], m: Mat, rot: THREE.Quaternion | null = null, surface: SurfaceKind = 'concrete') => {
    const mesh = new THREE.Mesh(unit, render.materials.world(m));
    mesh.position.set(...c);
    mesh.scale.set(h[0] * 2, h[1] * 2, h[2] * 2);
    if (rot) mesh.quaternion.copy(rot);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    render.scene.add(mesh);
    physics.addStaticBox(v(...c), v(...h), rot, surface);
  };
  add([0, -0.5, 0], [30, 0.5, 30], 'concrete');
  add([0, 5, -6], [30, 5, 0.5], 'concreteDark');
  add([-22, 5, 0], [0.5, 5, 30], 'concreteDark');
  add([22, 5, 0], [0.5, 5, 30], 'concreteDark');
  // Stairs up to a ledge on the left, a slope on the right. The stairs scenario throws bodies down both.
  for (let i = 0; i < 10; i++) add([-12, (i + 1) * 0.15, 0.2 - i * 0.34], [3, (i + 1) * 0.15, 0.17], 'steel');
  add([-12, 1.6, -4.45], [3, 1.6, 1.3], 'steel');
  const slope = new THREE.Quaternion().setFromAxisAngle(v(1, 0, 0), 0.5);
  add([12, 1.2, -1], [3, 0.2, 3.4], 'concrete', slope);
}

interface Scenario {
  /** Where the row stands and who is in it. */
  setup(s: Stage): void;
  /** Runs every frame with the frame number since the start. */
  frame?(s: Stage, f: number): void;
  camera: [number, number, number, number, number, number];
  /** Seconds per frame. Under 1/60 is slow motion. */
  dt?: number;
  /** Left half of the frame is hard limits, right half is muscles. A contact sheet labels them. */
  compare?: boolean;
  /** Draws over each cell of a contact sheet. */
  overlay?(s: Stage, c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void;
}

class Stage {
  row: CharacterInstance[] = [];
  frame = 0;
  physicsPeak = 0;
  physicsTotal = 0;
  physicsFrames = 0;
  readonly physicsSamples: number[] = [];
  /** Knee angle per frame, hard then muscles, for the slow-motion plot. */
  readonly knees: [number[], number[]] = [[], []];

  constructor(readonly ctx: Ctx, readonly gore: Gore, readonly spawnChar: () => CharacterInstance, readonly render: Renderer) {}

  place(x: number, z: number, yaw = 0, y = 0): CharacterInstance {
    const c = this.spawnChar();
    c.root.position.set(x, y, z);
    c.root.rotation.y = yaw;
    this.render.scene.add(c.root);
    c.root.updateMatrixWorld(true);
    this.row.push(c);
    return c;
  }

  /** A real shot: ray through the capsule test, then whatever the caller wants done with the hit. */
  aim(c: CharacterInstance, bone: number, from: THREE.Vector3): { hit: CapsuleHit; dir: THREE.Vector3 } | null {
    c.root.updateMatrixWorld(true);
    const hitDef = c.rig.bones[bone]!.hit;
    const target = hitDef
      ? new THREE.Vector3(...hitDef.to).add(new THREE.Vector3(...hitDef.from)).multiplyScalar(0.5)
      : new THREE.Vector3();
    target.applyMatrix4(c.bones[bone]!.matrixWorld);
    const dir = target.clone().sub(from).normalize();
    const hit = this.gore.raycastCharacter(c, from, dir, 80);
    return hit ? { hit, dir } : null;
  }

  damage(hit: CapsuleHit, dir: THREE.Vector3, amount: number, type: DamageType = 'bullet', force = 0): DamageInfo {
    return {
      amount, type, point: hit.point.clone(), dir: dir.clone(), force, source: 'sandbox', region: hit.region, bone: hit.bone,
    };
  }

  /** Kills with a ragdoll, impulse at the struck bone. */
  kill(c: CharacterInstance, bone: number, from: THREE.Vector3, force = 260, muscles?: boolean): void {
    const a = this.aim(c, bone, from);
    if (!a) return;
    this.ctx.fx.bloodHit(a.hit.point, a.dir, 1);
    this.gore.ragdoll(c, {
      impulses: [{ bone: a.hit.bone, point: a.hit.point.clone(), impulse: a.dir.clone().multiplyScalar(force) }],
      muscles,
    });
  }

  sever(c: CharacterInstance, region: GoreRegion, bone: number, from: THREE.Vector3, force = 0): void {
    const a = this.aim(c, bone, from);
    if (!a) {
      console.warn('sever missed', region);
      return;
    }
    this.gore.sever(c, region, this.damage(a.hit, a.dir, 60, 'pellet', force));
  }

  shootCorpse(from: THREE.Vector3, at: THREE.Vector3, amount: number): boolean {
    const dir = at.clone().sub(from).normalize();
    const hit = this.gore.raycastCorpses(from, dir, 60);
    if (!hit) return false;
    this.gore.damageCorpse(hit, {
      amount, type: 'bullet', point: hit.point.clone(), dir, force: 0, source: 'sandbox',
    });
    return true;
  }
}

const EYE = v(0, 1.6, 9);
/** Frames drawn before each cell of a contact sheet. */
const SHEET_RUN_UP = 12;
/** Faces +X, so a camera looking down -Z sees every character in profile. */
const PROFILE = Math.PI / 2;

const bonePos = (c: CharacterInstance, bone: number) => new THREE.Vector3().setFromMatrixPosition(c.bones[bone]!.matrixWorld);
const kneeAngle = (c: CharacterInstance) => {
  const q = c.bones[B.shinL]!.quaternion;
  return 2 * Math.atan2(q.x, q.w);
};

/** The two bodies of a side-by-side scenario, in profile. Hard limits on the left. */
function placePair(s: Stage, left: number, right: number, y = 0): void {
  s.place(left, 0, PROFILE, y);
  s.place(right, 0, PROFILE, y);
}

/** Hits for the ten bodies of a line-up: bone, and force in newton-seconds. */
const LINEUP_HITS: readonly [number, number][] = [
  [B.chest, 0], [B.chest, 170], [B.head, 170], [B.hips, 260], [B.thighL, 260],
  [B.chest, 400], [B.upperArmR, 200], [B.head, 300], [B.hips, 120], [B.thighR, 340],
];

const scenarios: Record<string, Scenario> = {
  idle: {
    camera: [0, 1.6, 6, 0, 1, 0],
    setup(s) {
      for (let i = -2; i <= 2; i++) s.place(i * 1.6, 0);
    },
  },
  ragdoll: {
    camera: [0, 1.3, 4.6, 0, 0.7, 0],
    setup(s) {
      for (let i = -2; i <= 2; i++) s.place(i * 1.5, 0, i * 0.5);
    },
    frame(s, f) {
      const r = s.row;
      if (f === 20) s.kill(r[0]!, B.chest, EYE);
      if (f === 24) s.kill(r[1]!, B.head, EYE, 200);
      if (f === 28) s.kill(r[2]!, B.hips, EYE, 300);
      if (f === 32) s.kill(r[3]!, B.thighL, EYE, 300);
      if (f === 36) s.kill(r[4]!, B.upperArmR, EYE, 200);
    },
  },
  limbs: {
    camera: [0, 1.5, 6.5, 0, 0.9, 0],
    setup(s) {
      for (let i = -2; i <= 2; i++) s.place(i * 2, 0);
    },
    frame(s, f) {
      const r = s.row;
      if (f === 20) s.sever(r[0]!, 'armL', B.upperArmL, EYE);
      if (f === 26) s.sever(r[1]!, 'forearmR', B.foreArmR, EYE);
      if (f === 32) s.sever(r[2]!, 'legL', B.thighL, EYE);
      if (f === 38) s.sever(r[3]!, 'shinR', B.shinR, EYE);
      if (f === 44) s.sever(r[4]!, 'abdomen', B.spine, EYE);
      if (f === 100) s.gore.ragdoll(r[2]!);
      if (f === 104) s.gore.ragdoll(r[4]!);
    },
  },
  /** Any rig, humanoid or not: cuts the first severable region, then kills one each way. */
  rigs: {
    camera: [0, 1.6, 5, 0, 0.5, 0],
    setup(s) {
      for (let i = -1; i <= 1; i++) s.place(i * 2.4, 0, 0, 0.6);
    },
    frame(s, f) {
      const [a, b, c] = s.row;
      if (f === 20) {
        const [region, bone] = [...rigInfo(a!.rig).severBone.entries()].at(-1)!;
        const from = v(0, 2.4, 9);
        const hit = s.aim(a!, bone, from);
        console.log('rigs sever', region, hit ? s.gore.sever(a!, region, s.damage(hit.hit, hit.dir, 60))?.regions.join(',') : 'missed');
      }
      if (f === 30) s.gore.ragdoll(a!);
      if (f === 40) s.gore.ragdoll(b!, { velocity: v(0, 0, 2) });
      if (f === 50) s.gore.gib(c!, v(2.4, 0, 0.6), 500);
    },
  },
  crawl: {
    camera: [1.6, 1.1, 2.6, 0, 0.3, 0.2],
    setup(s) {
      s.place(0, -1);
    },
    frame(s, f) {
      if (f === 20) {
        const a = s.aim(s.row[0]!, B.spine, EYE)!;
        s.gore.sever(s.row[0]!, 'abdomen', s.damage(a.hit, a.dir, 80, 'slash', 60));
      }
      if (f === 60) s.gore.ragdoll(s.row[0]!);
    },
  },
  headshot: {
    camera: [0.5, 1.7, 5.5, 0, 1.3, 0],
    setup(s) {
      for (let i = -1; i <= 1; i++) s.place(i * 2.2, 0);
    },
    frame(s, f) {
      const r = s.row;
      const shot = (c: CharacterInstance, amount: number) => {
        const a = s.aim(c, B.head, EYE);
        // A bullet: a burst at 40 or more, a hole under it (docs/proposals/partial-head-wounds.md).
        if (a) s.gore.headshot(c, s.damage(a.hit, a.dir, amount), undefined, amount >= 40 ? 'burst' : 'hole');
      };
      if (f === 20) shot(r[1]!, 50);
      if (f === 60) shot(r[0]!, 20);
      if (f === 100) shot(r[2]!, 50);
    },
  },
  explosion: {
    camera: [0, 2.5, 8, 0, 1, 0],
    setup(s) {
      for (let i = -2; i <= 2; i++) s.place(i * 1.3, -i * 0.3);
    },
    frame(s, f) {
      if (f !== 20) return;
      const center = v(0.3, 0.4, 0.4);
      s.ctx.fx.explosion(center, { radius: 6, kind: 'rocket' });
      const r = s.row;
      s.gore.gib(r[2]!, center, 700);
      s.gore.gib(r[1]!, center, 500);
      s.gore.ragdoll(r[0]!);
      s.gore.ragdoll(r[3]!);
      s.gore.ragdoll(r[4]!);
      s.ctx.physics.radialImpulse(center, 7, 140);
    },
  },
  slice: {
    camera: [0, 1.5, 5.2, 0, 0.95, 0],
    setup(s) {
      for (let i = -1; i <= 1; i++) s.place(i * 2.2, 0);
    },
    frame(s, f) {
      const r = s.row;
      const cut = (c: CharacterInstance, n: THREE.Vector3, y: number, dir: THREE.Vector3) => {
        const p = new THREE.Vector3().setFromMatrixPosition(c.bones[0]!.matrixWorld);
        p.y = y;
        s.gore.slice(c, p, n.clone().normalize(), {
          amount: 200, type: 'slash', point: p.clone(), dir, force: 0, source: 'sword', slicePlaneNormal: n,
        });
      };
      if (f === 20) cut(r[1]!, v(0.45, 1, 0.1), 1.15, v(1, 0, 0));
      if (f === 60) cut(r[0]!, v(1, 0.05, 0.15), 1, v(0, -1, 0));
      if (f === 100) cut(r[2]!, v(0, 1, 0.15), 0.9, v(-1, 0, 0));
    },
  },
  shootcorpse: {
    camera: [1.2, 1.6, 4, 0, 0.5, -3.6],
    setup(s) {
      s.place(-1, -4);
      s.place(1, -4.6);
    },
    frame(s, f) {
      const r = s.row;
      if (f === 10) {
        s.kill(r[0]!, B.chest, EYE, 300);
        s.kill(r[1]!, B.chest, EYE, 700);
      }
      // By now both have frozen. Every shot below lands on a static corpse first.
      if (f >= 180 && f <= 240 && f % 15 === 0) {
        const c = r[0]!;
        const p = v(0, -0.2, 0).applyMatrix4(c.bones[B.thighL]!.matrixWorld);
        console.log('corpse shot', s.shootCorpse(EYE, p, 40));
      }
      if (f === 300) {
        const c = r[1]!;
        const p = new THREE.Vector3().setFromMatrixPosition(c.bones[B.chest]!.matrixWorld);
        const dir = p.clone().sub(EYE).normalize();
        const hit = s.gore.raycastCorpses(EYE, dir, 40);
        if (hit) s.gore.pin(hit, v(p.x, 1.9, -5.45));
      }
    },
  },
  stairs: {
    camera: [-6.5, 3.4, 4.4, -12, 1.4, -1.6],
    setup(s) {
      s.place(-13, -3.5, 0, 3.25);
      s.place(-11.8, -3.5, 0.6, 3.25);
      s.place(-10.6, -3.9, 3.1, 3.25);
    },
    frame(s, f) {
      if (f !== 20) return;
      for (const c of s.row) {
        s.gore.ragdoll(c, {
          velocity: v(0, 0, 3),
          impulses: [{ bone: B.chest, point: new THREE.Vector3().setFromMatrixPosition(c.bones[B.chest]!.matrixWorld), impulse: v(0, 0, 90) }],
        });
      }
    },
  },
  /** A foot kicked hard so the knee slams straight, at a quarter of a sixtieth of a second per frame. */
  limit: {
    camera: [-0.15, 1.15, 2.7, -0.15, 1.15, 0],
    dt: 1 / 240,
    compare: true,
    setup(s) {
      s.ctx.physics.world.gravity = { x: 0, y: 0, z: 0 };
      placePair(s, -1.3, 1, 0.4);
    },
    frame(s, f) {
      if (f === 6) {
        s.row.forEach((c, i) => {
          s.gore.ragdoll(c, {
            muscles: i === 1,
            impact: { dir: v(1, 0, 0), strength: 0 },
            impulses: [{ bone: B.shinL, point: bonePos(c, B.footL), impulse: v(28, 0, 0) }],
          });
        });
      }
      s.row.forEach((c, i) => s.knees[i]!.push(kneeAngle(c)));
    },
    overlay(s, c, x, y, w, h) {
      const [hard, soft] = s.knees;
      const top = y + h * 0.5;
      const height = h * 0.42;
      const toY = (angle: number) => top + height - ((Math.max(-0.2, Math.min(0.9, angle)) + 0.2) / 1.1) * height;
      c.fillStyle = '#00000080';
      c.fillRect(x + 4, top - 4, w - 8, height + 8);
      c.strokeStyle = '#ffffff50';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(x + 8, toY(0));
      c.lineTo(x + w - 8, toY(0));
      c.stroke();
      const plot = (line: number[], color: string) => {
        c.strokeStyle = color;
        c.lineWidth = 3;
        c.beginPath();
        line.forEach((a, i) => {
          if (i < 6 || i > 120) return;
          const px = x + 8 + ((i - 6) / 114) * (w - 16);
          if (i === 6) c.moveTo(px, toY(a));
          else c.lineTo(px, toY(a));
        });
        c.stroke();
      };
      plot(hard, '#ff5a4a');
      plot(soft, '#54e08a');
    },
  },
  /** With nothing to fall toward, muscles alone decide the pose. It should be the one NASA measured. */
  zerog: {
    camera: [-0.1, 1.75, 2.9, -0.1, 1.75, 0],
    compare: true,
    setup(s) {
      s.ctx.physics.world.gravity = { x: 0, y: 0, z: 0 };
      placePair(s, -1.3, 1.1, 0.9);
    },
    frame(s, f) {
      if (f === 10) s.row.forEach((c, i) => s.gore.ragdoll(c, { muscles: i === 1 }));
    },
  },
  fall: {
    camera: [-0.15, 0.95, 3.1, -0.15, 0.8, 0],
    compare: true,
    setup(s) {
      placePair(s, -1.5, 1.2);
    },
    frame(s, f) {
      if (f === 20) s.row.forEach((c, i) => s.gore.ragdoll(c, { muscles: i === 1 }));
    },
  },
  stairsab: {
    camera: [-12, 3.5, 4.3, -12, 0.7, 0.3],
    compare: true,
    setup(s) {
      s.place(-13.4, -3.5, 0, 3.25);
      s.place(-10.6, -3.5, 0, 3.25);
    },
    frame(s, f) {
      if (f !== 20) return;
      s.row.forEach((c, i) => {
        s.gore.ragdoll(c, {
          muscles: i === 1,
          velocity: v(0, 0, 3),
          impulses: [{ bone: B.chest, point: bonePos(c, B.chest), impulse: v(0, 0, 90) }],
        });
      });
    },
  },
  /** A blast in front of each body, far enough apart that neither reaches the other. Arms back, legs forward. */
  blast: {
    camera: [2.6, 1.3, 5, 2.6, 1.05, 0],
    compare: true,
    setup(s) {
      placePair(s, 1.6, 7.6);
    },
    frame(s, f) {
      if (f !== 20) return;
      s.row.forEach((c, i) => {
        s.gore.ragdoll(c, { muscles: i === 1 });
        s.ctx.physics.radialImpulse(new THREE.Vector3(c.root.position.x + 1.3, 1, 0), 3.2, 125);
      });
    },
  },
  /** Ten bodies each way, dropped in turn so that the cap on live ragdolls never freezes one early. */
  lineup: {
    camera: [0, 6.2, 4.6, 0, 0, 1.2],
    setup(s) {
      for (let row = 0; row < 2; row++) {
        for (let i = 0; i < 10; i++) s.place(-9 + i * 2, row === 0 ? -1.2 : 3.6, i * 1.7);
      }
    },
    frame(s, f) {
      const row = f === 20 ? 0 : f === 300 ? 1 : -1;
      if (row < 0) return;
      for (let i = 0; i < 10; i++) {
        const c = s.row[row * 10 + i]!;
        const [bone, force] = LINEUP_HITS[i]!;
        const a = i * 2.4;
        if (force === 0) s.gore.ragdoll(c, { muscles: row === 1 });
        else s.kill(c, bone, bonePos(c, bone).add(v(Math.sin(a) * 6, 0.4, Math.cos(a) * 6)), force, row === 1);
      }
    },
  },
  /** Dropped dead, collapsing on the spot, and collapsing on the move. */
  collapse: {
    camera: [0.2, 1.05, 3.3, 0.2, 0.75, 0],
    setup(s) {
      s.place(-3.2, 0, PROFILE);
      s.place(-0.6, 0, PROFILE);
      s.place(0.6, 0, PROFILE);
    },
    frame(s, f) {
      const [dropped, still, walker] = s.row;
      if (f < 20) {
        walker!.anim.setLocomotion({ speed: 2.2, moveX: 0, moveZ: 1, aimYaw: 0, aimPitch: 0, grounded: true });
        walker!.root.position.x += 2.2 / 60;
      }
      if (f === 20) {
        s.gore.ragdoll(dropped!, { muscles: false });
        s.gore.collapse(still!);
        s.gore.collapse(walker!, { velocity: v(2.2, 0, 0) });
      }
    },
  },
  /**
   * The weight pass: four deaths in profile, each shot from in front at frame 20. Dropped, a lethal headshot, an SMG
   * collapse and a Judge round to the chest. `&weight=0` shows the same four from before it.
   */
  weight: {
    camera: [0, 0.95, 3.7, 0, 0.6, 0],
    setup(s) {
      for (const x of [-3.9, -1.3, 1.3, 3.9]) s.place(x, 0, PROFILE);
    },
    frame(s, f) {
      if (f !== 20) return;
      const [dropped, headshot, collapse, judge] = s.row;
      const back = v(-1, 0, 0);
      s.gore.ragdoll(dropped!);
      const a = s.aim(headshot!, B.head, bonePos(headshot!, B.head).add(v(4, 0, 0)));
      if (a) s.gore.headshot(headshot!, s.damage(a.hit, a.dir, 50, 'bullet', 20));
      s.gore.collapse(collapse!, { duration: 1.1, hit: { bone: B.chest, point: bonePos(collapse!, B.chest), dir: back, force: 20 } });
      s.gore.ragdoll(judge!, { impulses: [{ bone: B.chest, point: bonePos(judge!, B.chest), impulse: v(-40, 6, 0) }] });
    },
    overlay(s, c, x, y, w, h) {
      c.fillStyle = '#ffffffc0';
      ['drop', 'headshot', 'collapse', 'judge'].forEach((name, i) => c.fillText(name, x + w * [0.05, 0.31, 0.58, 0.85][i]!, y + h - 8 * devicePixelRatio));
    },
  },
  /**
   * Knocked over, alive, at frame 20, and back up: a body check from the front (3 m/s of the run kept, tipped back at 2.4), a
   * head hit that knocks it cold, and a rocket's blast 3 m in front of the third, which faces the camera, so its hands can be
   * seen on its face in the air. The blast goes off before the other two are down, or it would throw them as well.
   * `&knock=0` shows them from before.
   */
  knock: {
    camera: [0, 1.25, 4.9, 0, 0.5, -0.4],
    setup(s) {
      s.place(-2.6, 1, PROFILE);
      s.place(0, 1, PROFILE);
      s.place(2.6, 1, 0);
    },
    frame(s, f) {
      if (f !== 20) return;
      const [check, cold, thrown] = s.row;
      const back = v(-1, 0, 0);
      const up = { lie: 0.3, rise: 1.3, hurt: 0 };
      s.gore.knockdown(thrown!, { ...up });
      s.ctx.physics.radialImpulse(v(2.6, 0.3, 4), 8 * 1.35, 12 * 8);
      s.gore.knockdown(check!, {
        ...up, velocity: back.clone().multiplyScalar(3), topple: back.clone().multiplyScalar(2.4), impact: { dir: back, strength: 0.38 },
        wound: { bone: B.chest, point: bonePos(check!, B.chest) },
      });
      const a = s.aim(cold!, B.head, bonePos(cold!, B.head).add(v(4, 0, 0)));
      s.gore.knockdown(cold!, {
        ...up, lie: 0.45, topple: back.clone().multiplyScalar(1.9), impact: { dir: back, strength: 0.28 }, knockout: true,
        wound: { bone: B.head, point: a ? a.hit.point.clone() : bonePos(cold!, B.head) },
      });
    },
    overlay(s, c, x, y, w, h) {
      c.fillStyle = '#ffffffc0';
      ['check', 'cold', 'blast'].forEach((name, i) => c.fillText(name, x + w * [0.16, 0.47, 0.78][i]!, y + h - 8 * devicePixelRatio));
    },
  },
  /** Both dropped dead on muscles, only the one on the right twitching. */
  twitch: {
    camera: [0, 1.2, 2.1, 0, 0.1, 0],
    setup(s) {
      placePair(s, -1, 1);
    },
    frame(s, f) {
      if (f === 10) s.row.forEach((c, i) => s.gore.ragdoll(c, { muscles: i === 1, twitch: i }));
    },
  },
  stress: {
    camera: [0, 3.2, 7, 0, 0.5, 0],
    setup(s) {
      for (let i = 0; i < 20; i++) s.place((i % 7 - 3) * 1.1, -2 + Math.floor(i / 7) * 1.4, i, 0.2 + (i % 3) * 0.8);
    },
    frame(s, f) {
      if (f < 12 || f % 4 !== 0) return;
      const i = (f - 12) / 4;
      const c = s.row[i];
      if (!c) return;
      const legs: [GoreRegion, number][] = [['armL', B.upperArmL], ['armR', B.upperArmR], ['legR', B.thighR]];
      const [region, bone] = legs[i % 3]!;
      s.sever(c, region, bone, EYE);
      if (i % 2 === 0) s.sever(c, 'forearmR', B.foreArmR, EYE);
      s.gore.ragdoll(c);
    },
  },
};

export default async function goreSandbox(params: URLSearchParams): Promise<void> {
  const physics = await Physics.create();
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const render = (await createRenderSystem(canvas)) as Renderer;
  const ctx = makeCtx({ render, physics });
  render.init(ctx);
  if (params.get('q')) render.setQuality(Number(params.get('q')));

  buildRoom(render, physics);
  physics.flushQueries();
  await render.bakeLightVolume({
    bounds: new THREE.Box3(v(-24, -1, -8), v(24, 12, 20)),
    lights: LIGHTS,
    isSolid: (_x, y) => y < 0,
  });

  const fx = createFx(ctx);
  ctx.fx = fx as FxSystem;
  fx.init?.();

  const arch = params.get('arch') ?? 'husk';
  const library = createCharacterLibrary(ctx);
  const useDummy = params.get('dummy') === '1';
  if (!useDummy) await library.load([arch]);
  const rig = humanoidRig('dummy');
  const spawnChar = (): CharacterInstance => (useDummy ? new TestDummy(rig) : library.spawn(arch));

  const gore = createGoreSystem(ctx);
  ctx.gore = gore;
  gore.init();

  const stage = new Stage(ctx, gore, spawnChar, render);
  const name = params.get('scenario') ?? 'idle';
  const scenario = scenarios[name];
  if (!scenario) throw new Error(`Unknown scenario "${name}". Try: ${Object.keys(scenarios).join(' ')}`);
  scenario.setup(stage);

  const cam = (params.get('cam')?.split(',').map(Number) ?? scenario.camera) as [number, number, number, number, number, number];
  render.camera.position.set(cam[0], cam[1], cam[2]);
  render.camera.lookAt(cam[3], cam[4], cam[5]);

  const frameSeconds = scenario.dt ?? 1 / 60;
  const tick = (draw = true): void => {
    ctx.time.tick(frameSeconds);
    scenario.frame?.(stage, stage.frame++);
    for (const c of stage.row) {
      const live = (c as { live?: boolean }).live;
      // A body knocked down is still its owner's, but gore has its bones until it gets up.
      if (live !== false && !gore.owns(c) && !gore.downed(c)) c.anim.update(ctx.time.dt, 0);
      (c as { tick?(dt: number): void }).tick?.(ctx.time.dt);
    }
    physics.step(ctx.time.dt);
    // The first frames carry WebAssembly warm-up, which is not what the budget is about.
    if (stage.frame > 8) {
      stage.physicsPeak = Math.max(stage.physicsPeak, physics.stepMs);
      stage.physicsTotal += physics.stepMs;
      stage.physicsFrames++;
      // Only with bodies in the air: a median over idle frames says nothing about the budget.
      if (gore.stats().ragdolls >= 10) stage.physicsSamples.push(physics.stepMs);
    }
    gore.update();
    fx.update?.();
    if (draw) render.render();
  };

  let held = params.get('hold') === '1';
  let frames = 0;
  let last = performance.now();
  let fps = 0;
  const loop = (now: number): void => {
    requestAnimationFrame(loop);
    if (held) return;
    tick();
    frames++;
    fps = 1000 / Math.max(1, now - last);
    last = now;
  };
  requestAnimationFrame(loop);

  const sheet = (frameList: number[], columns: number): void => {
    const rows = Math.ceil(frameList.length / columns);
    const dpr = devicePixelRatio;
    const w = Math.floor((innerWidth * dpr) / columns);
    const h = Math.floor(w * (innerHeight / innerWidth));
    const out = document.createElement('canvas');
    out.width = w * columns;
    out.height = h * rows;
    out.style.cssText = `position:fixed;left:0;top:0;z-index:9;background:#000;width:${out.width / dpr}px`;
    const c2 = out.getContext('2d')!;
    c2.font = `${13 * dpr}px monospace`;
    frameList.forEach((f, i) => {
      // Undrawn frames are most of what a long sheet saves, but the post stack comes out dark and dithered until it
      // has drawn a few in a row, so every cell gets a run-up.
      while (stage.frame < f) tick(stage.frame + SHEET_RUN_UP >= f);
      const x = (i % columns) * w;
      const y = Math.floor(i / columns) * h;
      c2.drawImage(canvas, x, y, w, h);
      c2.fillStyle = '#ffee44';
      c2.fillText(`f${f} ${(f * frameSeconds).toFixed(2)}s`, x + 6 * dpr, y + 16 * dpr);
      if (scenario.compare) {
        c2.fillStyle = '#ff8a7a';
        c2.fillText('HARD', x + w * 0.08, y + h - 8 * dpr);
        c2.fillStyle = '#7af0a8';
        c2.fillText('MUSCLES', x + w * 0.72, y + h - 8 * dpr);
      }
      scenario.overlay?.(stage, c2, x, y, w, h);
    });
    document.body.appendChild(out);
    canvas.style.visibility = 'hidden';
  };

  const pub = {
    ctx,
    gore,
    stage,
    hold: () => {
      held = true;
    },
    step: (n: number) => {
      for (let i = 0; i < n; i++) tick();
    },
    sheet,
  };
  (window as unknown as { __gore: typeof pub }).__gore = pub;
  (window as unknown as { __op2: unknown }).__op2 = {
    ctx,
    stats: () => ({
      fps,
      frames,
      physicsMs: physics.stepMs,
      physicsPeak: stage.physicsPeak,
      physicsAvg: stage.physicsTotal / Math.max(1, stage.physicsFrames),
      physicsMedian: [...stage.physicsSamples].sort((a, b) => a - b)[stage.physicsSamples.length >> 1] ?? 0,
      physicsSamples: stage.physicsSamples.length,
      drawCalls: render.drawCalls(),
      triangles: render.triangles(),
      ...gore.stats(),
      cutMs: gore.sliced.lastCutMs,
    }),
  };
}
