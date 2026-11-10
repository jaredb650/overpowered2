// The weight probe: what makes a ragdoll read as heavy or light, measured. Real Rapier, real gore, real HumanoidAnimator,
// no browser. Run it through its vitest wrapper, one run at a time:
//   PROBE=deaths,pose nice npx vitest run tools/scripts/ragweight.test.ts --testTimeout=60000
// Each section is written to tools/out/ragweight/<PROBE_PREFIX><section>.json. PROBE_ONLY narrows `fixes` and `sweep` to some
// of their cases. Trust 6-heading means only, and several rounds of them: the animator starts every body at a random phase,
// and MuscleState seeds come from a module counter, so no two runs are alike.
// Sections: mass deaths ab arm hits variants pose fixes twitch trace flinch, which `all` runs, and sweep freeze collapse
// tempo hitmass, which run only when named. PROBE_ROUNDS sets how many rounds of six headings `hitmass` runs. PROBE_SET=rag.heelFeet=0,muscle.trunkCut=1 sets tuning first; PROBE_CUTS=1,0 is the trunk
// cuts `collapse` runs. Before the weight pass, `PROBE_SET=rag.heelFeet=0,muscle.trunkCut=1,gore.headshotTwitch=1`. Any section
// runs on the tempo dial with PROBE_SET=rag.gravityScale=0.6; `tempo` runs its own, PROBE_DIALS=1,0.75,0.6.
import { mkdirSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { archetypeById, rigFor } from '../../src/characters/archetypes';
import { HumanoidAnimator } from '../../src/characters/animation/HumanoidAnimator';
import { HumanoidBone as B, type RigDef } from '../../src/characters/rig';
import { GRAVITY, Physics } from '../../src/physics/Physics';
import { makeCtx } from '../../src/sandbox/harness';
import type { Ctx, DamageInfo } from '../../src/core/contracts';
import * as damageModel from '../../src/enemies/damage';
import { ENEMIES } from '../../src/enemies/data';
import { createGoreSystem, GoreTuning, type Gore } from '../../src/gore/index';
import { MuscleState, MuscleTuning } from '../../src/gore/muscles';
import { Rag, RagTuning } from '../../src/gore/rag';
import { rigInfo } from '../../src/gore/rigInfo';
import { TestDummy } from '../../src/gore/testDummy';

const sections = (process.env.PROBE ?? process.argv[2] ?? 'all').split(',').map(s => s.trim()).filter(Boolean);
/** Sections added for the weight pass and the tempo dial. They run only when named. */
const NAMED_ONLY = new Set(['sweep', 'freeze', 'collapse', 'tempo', 'hitmass']);
const want = (s: string) => sections.includes(s) || (sections.includes('all') && !NAMED_ONLY.has(s));
const OUT_DIR = new URL('../out/ragweight/', import.meta.url).pathname;
const PREFIX = process.env.PROBE_PREFIX ?? '';
mkdirSync(OUT_DIR, { recursive: true });
function saveSection(name: string, data: unknown): void {
  writeFileSync(`${OUT_DIR}${PREFIX}${name}.json`, JSON.stringify({ [name]: data }, null, 1));
}
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

// ------------------------------------------------------------------------------------------------
// World
// ------------------------------------------------------------------------------------------------
const physics = await Physics.create();
const scene = new THREE.Scene();
const ctx: Ctx = makeCtx({ physics, render: { scene, decals: { add() {}, splat() {}, clear() {} } } as unknown as Ctx['render'] });
const gore: Gore = createGoreSystem(ctx);
gore.init();
physics.addStaticBox(v(0, -0.5, 0), v(80, 0.5, 80), null, 'concrete');
physics.flushQueries();

// Tally of every linear impulse applied inside a physics sub-step, by who applied it.
let tag = 'event';
const tally: Record<string, THREE.Vector3> = { hold: v(0, 0, 0), ligament: v(0, 0, 0), event: v(0, 0, 0) };
const proto = RAPIER.RigidBody.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
const origApply = proto.applyImpulse!;
proto.applyImpulse = function (this: unknown, imp: { x: number; y: number; z: number }, wake: boolean) {
  const t = tally[tag] ?? (tally[tag] = v(0, 0, 0));
  t.x += imp.x; t.y += imp.y; t.z += imp.z;
  return origApply.call(this, imp, wake);
} as (...a: unknown[]) => unknown;
const mproto = MuscleState.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
const origHold = mproto.holdHips!;
mproto.holdHips = function (this: unknown, ...a: unknown[]) {
  const prev = tag; tag = 'hold';
  try { return origHold.apply(this, a); } finally { tag = prev; }
};
const rproto = Rag.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
const origPre = rproto.preStep!;
rproto.preStep = function (this: unknown, ...a: unknown[]) {
  const prev = tag; tag = 'ligament';
  try { return origPre.apply(this, a); } finally { tag = prev; }
};
let noGravityScale = false;
/** Share of the muscles' gravity cut that is kept: 1 as written, 0 none. */
let cutKeep = 1;
const origGS = proto.setGravityScale!;
proto.setGravityScale = function (this: unknown, s: number, w: boolean) {
  return origGS.call(this, noGravityScale ? 1 : 1 - cutKeep * (1 - s), w);
} as (...a: unknown[]) => unknown;

let substeps = 1;
function frame(): void {
  ctx.time.tick(1 / 60);
  const dt = ctx.time.dt;
  if (substeps === 1) physics.step(dt);
  else for (let i = 0; i < substeps; i++) physics.step(dt / substeps);
  gore.update();
}

// ------------------------------------------------------------------------------------------------
// Bodies
// ------------------------------------------------------------------------------------------------
const rigs = new Map<string, RigDef>();
let rigVariant = '';
const rigOf = (id: string): RigDef => {
  const key = id + '|' + rigVariant;
  let r = rigs.get(key);
  if (!r) {
    r = rigFor(archetypeById(id));
    if (rigVariant === 'ankle') {
      // Scratch only: the foot gets its own body on a hinge, so the shin is no longer a boot that stands by itself.
      r = { ...r, bones: r.bones.map(b => b.name.startsWith('foot') ? { ...b, ragdoll: 'body' as const, joint: { kind: 'hinge' as const, axis: [1, 0, 0] as const, min: -0.35, max: 0.87, role: 'leg' as const } } : b) };
    }
    if (rigVariant === 'heel') {
      // The foot stays merged, but its collider is a ball at the heel, so the shin has no base to stand on. Only the
      // collider: hits, mass, cuts and slices still read `hit`, so the foot keeps its weight.
      r = { ...r, bones: r.bones.map(b => b.name.startsWith('foot') && b.hit ? { ...b, collider: { from: [0, -0.03, 0] as const, to: [0, -0.03, 0.001] as const, radius: b.hit.radius } } : b) };
    }
    rigs.set(key, r);
  }
  return r;
};

type Body = TestDummy;
const hiddenOf = (c: Body) => (c as unknown as { hidden: Uint8Array }).hidden;
function spawn(arch: string, x = 0, z = 0, yaw = 0, living = true, aim = false): Body {
  const rig = rigOf(arch);
  const c = new TestDummy(rig) as Body;
  c.root.position.set(x, 0, z);
  c.root.rotation.y = yaw;
  scene.add(c.root);
  if (living) {
    const anim = new HumanoidAnimator(c.bones, rig, archetypeById(arch), c.root, c.severed, b => hiddenOf(c)[b] === 1);
    (c as { anim: unknown }).anim = anim;
    for (let i = 0; i < 30; i++) {
      anim.setLocomotion({ speed: 0, moveX: 0, moveZ: 1, aimYaw: 0, aimPitch: 0, grounded: true, aiming: aim } as never);
      anim.update(1 / 60, 0);
    }
  }
  c.root.updateMatrixWorld(true);
  return c;
}
const ragOf = (c: Body): Rag | null => (gore as unknown as { owned: Map<Body, { rag: Rag | null }> }).owned.get(c)?.rag ?? null;
const pos = (c: Body, bone: number) => new THREE.Vector3().setFromMatrixPosition(c.bones[bone]!.matrixWorld);
const upOf = (c: Body, bone: number) => new THREE.Vector3(0, 1, 0).applyQuaternion(c.bones[bone]!.getWorldQuaternion(new THREE.Quaternion()));
const knee = (c: Body, bone: number) => { const q = c.bones[bone]!.quaternion; return Math.abs(2 * Math.atan2(q.x, q.w)); };

// ------------------------------------------------------------------------------------------------
// Recorder
// ------------------------------------------------------------------------------------------------
const TRACK = { hips: B.hips, chest: B.chest, head: B.head, handL: B.handL, handR: B.handR, footL: B.footL, footR: B.footR } as const;
type TrackName = keyof typeof TRACK;
interface Sample {
  t: number;
  p: Record<TrackName, THREE.Vector3>;
  kneeL: number; kneeR: number; kneeYL: number; kneeYR: number;
  chestTilt: number;
  com: THREE.Vector3 | null; mom: THREE.Vector3 | null; mass: number;
  gEff: number; holdY: number; ligY: number; maxSpeed: number; active: boolean;
}
function sample(c: Body, t: number): Sample {
  const p = {} as Record<TrackName, THREE.Vector3>;
  for (const k of Object.keys(TRACK) as TrackName[]) p[k] = pos(c, TRACK[k]);
  const rag = ragOf(c);
  let com: THREE.Vector3 | null = null;
  let mom: THREE.Vector3 | null = null;
  let mass = 0, gw = 0, maxSpeed = 0;
  if (rag && rag.active && rag.parts.length) {
    com = v(0, 0, 0); mom = v(0, 0, 0);
    for (const part of rag.parts) {
      const m = part.body.mass();
      const wc = part.body.worldCom();
      const lv = part.body.linvel();
      com.x += wc.x * m; com.y += wc.y * m; com.z += wc.z * m;
      mom.x += lv.x * m; mom.y += lv.y * m; mom.z += lv.z * m;
      mass += m; gw += m * part.body.gravityScale();
      maxSpeed = Math.max(maxSpeed, Math.hypot(lv.x, lv.y, lv.z));
    }
    com.divideScalar(mass);
  }
  const s: Sample = {
    t, p, kneeL: knee(c, B.shinL), kneeR: knee(c, B.shinR), kneeYL: pos(c, B.shinL).y, kneeYR: pos(c, B.shinR).y, chestTilt: upOf(c, B.chest).angleTo(v(0, 1, 0)),
    com, mom, mass, gEff: mass > 0 ? (gw / mass) * -GRAVITY : 0, holdY: tally.hold!.y, ligY: tally.ligament!.y, maxSpeed, active: !!rag?.active,
  };
  tally.hold!.set(0, 0, 0); tally.ligament!.set(0, 0, 0); tally.event!.set(0, 0, 0);
  return s;
}

function record(c: Body, frames: number, onFrame?: (f: number) => void): Sample[] {
  const out: Sample[] = [];
  let t = 0;
  out.push(sample(c, 0));
  for (let f = 1; f <= frames; f++) {
    onFrame?.(f);
    frame();
    t += ctx.time.dt;
    out.push(sample(c, t));
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// Death metrics
// ------------------------------------------------------------------------------------------------
const flat = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z);
interface DeathMetrics {
  [k: string]: unknown;
}
/** Seconds each collapse takes, for the end-drop measure. */
const COLLAPSE_SECONDS: Record<string, number> = { collapse: 1.1, 'collapse-smg': 1.1, 'collapse-0.85': 0.85, 'collapse-1.4': 1.4 };

function deathMetrics(s: Sample[], duration?: number): DeathMetrics {
  const n = s.length;
  const last = s[n - 1]!;
  const hips0 = s[0]!.p.hips.y;
  const hipsRest = last.p.hips.y;
  const iFloor = s.findIndex(x => x.p.hips.y <= hipsRest + 0.04);
  const tFloor = iFloor >= 0 ? s[iFloor]!.t : NaN;
  // Impact: the biggest single-frame loss of downward COM speed.
  let iImpact = -1, best = 0, vPeak = 0, iPeak = -1;
  for (let i = 2; i < n; i++) {
    const a = s[i - 1]!, b = s[i]!;
    if (!a.mom || !b.mom) continue;
    const va = a.mom.y / a.mass, vb = b.mom.y / b.mass;
    if (va < vPeak) { vPeak = va; iPeak = i - 1; }
    if (vb - va > best && va < -0.5) { best = vb - va; iImpact = i; }
  }
  const comPts = s.filter(x => x.com);
  const com0 = comPts[0]?.com?.y ?? NaN;
  const comRest = comPts.at(-1)?.com?.y ?? NaN;
  const iComFloor = s.findIndex(x => x.com && x.com.y <= comRest + 0.03);
  // COM fall vs free fall at 19 from rest: time for the same drop.
  const drop = com0 - comRest;
  const freeFall = Math.sqrt((2 * drop) / -GRAVITY);
  const freeFallReal = Math.sqrt((2 * drop) / 9.81);
  // Support share during the fall: weight carried by gravity cut, the hip hold, the floor (by difference).
  const end = iPeak > 1 ? iPeak : Math.min(n - 1, 30);
  let W = 0, gravCut = 0, hold = 0, lig = 0, dP = 0;
  let accFirst = NaN;
  for (let i = 2; i <= end; i++) {
    const a = s[i - 1]!, b = s[i]!;
    if (!a.mom || !b.mom) continue;
    const dt = b.t - a.t;
    if (dt <= 0) continue;
    W += a.mass * -GRAVITY * dt;
    gravCut += a.mass * (-GRAVITY - a.gEff) * dt;
    hold += b.holdY;
    lig += b.ligY;
    dP += b.mom.y - a.mom.y;
  }
  // Mean COM acceleration over the first 0.25 s.
  {
    const j = s.findIndex(x => x.t >= 0.25);
    const a = s[1]!, b = s[j]!;
    if (a.mom && b.mom) accFirst = (b.mom.y / b.mass - a.mom.y / a.mass) / (b.t - a.t);
  }
  // floor = dP + W - gravCut - hold - lig  (all upward positive)
  const floor = dP + W - gravCut - hold - lig;
  // Knees vs trunk.
  const iKnee = s.findIndex(x => Math.max(x.kneeL, x.kneeR) - Math.max(s[0]!.kneeL, s[0]!.kneeR) > 0.35);
  const iTilt = s.findIndex(x => x.chestTilt - s[0]!.chestTilt > 0.35);
  const iDrop10 = s.findIndex(x => hips0 - x.p.hips.y > 0.1);
  let maxKnee = 0;
  for (const x of s) maxKnee = Math.max(maxKnee, x.kneeL, x.kneeR);
  // Sitting on its heels: hips under 0.3 of their start height above the floor while a knee is still above 0.3 m... read off bones.
  const kneeYs = s.map(x => Math.max(x.kneeYL, x.kneeYR));
  const iKneesDown = s.findIndex(x => Math.max(x.kneeYL, x.kneeYR) < 0.2 * (hips0 / 0.9));
  let squat = 0;
  for (let i = 1; i < n; i++) if (s[i]!.p.hips.y < 0.3 * (hips0 / 0.9) && kneeYs[i]! > 0.33 * (hips0 / 0.9)) squat += s[i]!.t - s[i - 1]!.t;
  const footSlide = (i: number) => (i < 0 ? NaN : Math.max(flat(s[i]!.p.footL, s[0]!.p.footL), flat(s[i]!.p.footR, s[0]!.p.footR)));
  // Landing.
  let rebound = 0, comRebound = 0;
  if (iImpact > 0) {
    let lo = Infinity, clo = Infinity;
    for (let i = iImpact; i < Math.min(n, iImpact + 40); i++) {
      lo = Math.min(lo, s[i]!.p.hips.y);
      rebound = Math.max(rebound, s[i]!.p.hips.y - lo);
      if (s[i]!.com) { clo = Math.min(clo, s[i]!.com!.y); comRebound = Math.max(comRebound, s[i]!.com!.y - clo); }
    }
  }
  const iRest = (() => { for (let i = n - 1; i > 0; i--) if (s[i]!.active && s[i]!.maxSpeed > 0.1) return i + 1; return 0; })();
  const iFreeze = s.findIndex((x, i) => i > 0 && !x.active);
  const slideAfter = iImpact > 0 ? flat(last.p.hips, s[iImpact]!.p.hips) : NaN;
  // Once lying (COM within 8 cm of rest): how far the COM still travels across the floor, and for how long.
  const iLying = s.findIndex(x => x.com && x.com.y <= comRest + 0.08);
  const lastCom = comPts.at(-1)?.com;
  const lyingSlide = iLying >= 0 && lastCom ? flat(lastCom, s[iLying]!.com!) : NaN;
  // Secondary motion after impact: path of head and hands relative to chest.
  let headPath = 0, handPath = 0, headRelPeak = 0;
  let headStop = NaN;
  if (iImpact > 0) {
    for (let i = iImpact + 1; i < n; i++) {
      const a = s[i - 1]!, b = s[i]!;
      const rh = b.p.head.clone().sub(b.p.chest).sub(a.p.head.clone().sub(a.p.chest));
      const rl = b.p.handL.clone().sub(b.p.chest).sub(a.p.handL.clone().sub(a.p.chest));
      const rr = b.p.handR.clone().sub(b.p.chest).sub(a.p.handR.clone().sub(a.p.chest));
      headPath += rh.length();
      handPath += Math.max(rl.length(), rr.length());
      const sp = rh.length() / Math.max(b.t - a.t, 1e-6);
      headRelPeak = Math.max(headRelPeak, sp);
      if (sp > 0.25) headStop = b.t - s[iImpact]!.t;
    }
  }
  // Head and hands arrive: within 4 cm of where they rest.
  const arrive = (k: TrackName) => { const y = last.p[k].y; const i = s.findIndex(x => x.p[k].y <= y + 0.04); return i >= 0 ? s[i]!.t : NaN; };
  // Peak speeds of parts in the fall (bone displacement per frame).
  const peak = (k: TrackName) => { let m = 0; for (let i = 1; i < n; i++) { const dt = s[i]!.t - s[i - 1]!.t; if (dt > 0) m = Math.max(m, s[i]!.p[k].distanceTo(s[i - 1]!.p[k]) / dt); } return m; };
  // Last moment each part moved faster than 0.3 m/s, and knees too.
  const lastMove: Record<string, number> = {};
  for (const k of Object.keys(TRACK) as TrackName[]) {
    let tl = 0;
    for (let i = 1; i < n; i++) { const dt = s[i]!.t - s[i - 1]!.t; if (dt > 0 && s[i]!.p[k].distanceTo(s[i - 1]!.p[k]) / dt > 0.3) tl = s[i]!.t; }
    lastMove[k] = r2(tl);
  }
  {
    let tl = 0;
    for (let i = 1; i < n; i++) { const dt = s[i]!.t - s[i - 1]!.t; if (dt > 0 && Math.max(Math.abs(s[i]!.kneeYL - s[i - 1]!.kneeYL), Math.abs(s[i]!.kneeYR - s[i - 1]!.kneeYR)) / dt > 0.3) tl = s[i]!.t; }
    lastMove.kneeY = r2(tl);
  }
  // Jitter in the last 20 active frames.
  let jitter = 0;
  const jEnd = iFreeze > 0 ? iFreeze - 1 : n - 1;
  for (let i = Math.max(1, jEnd - 20); i <= jEnd; i++) for (const k of Object.keys(TRACK) as TrackName[]) jitter = Math.max(jitter, s[i]!.p[k].distanceTo(s[i - 1]!.p[k]));
  // Hips profile every 0.1 s.
  const profile: number[] = [];
  for (let t = 0; t <= 1.6; t += 0.1) { const i = s.findIndex(x => x.t >= t - 1e-6); if (i >= 0) profile.push(r2(s[i]!.p.hips.y)); }
  const accProfile: number[] = [];
  for (let t = 0.05; t <= 1.2; t += 0.05) {
    const i = s.findIndex(x => x.t >= t - 0.05 - 1e-6), j = s.findIndex(x => x.t >= t - 1e-6);
    const a = s[i], b = s[j];
    accProfile.push(a?.mom && b?.mom && b.t > a.t ? r2((b.mom.y / b.mass - a.mom.y / a.mass) / (b.t - a.t)) : NaN);
  }
  // The end of a collapse: from 0.6 of its duration to the fastest it falls, the largest change of the centre of mass's
  // acceleration between one 0.05 s window and the next. A drop that lands all at once reads as a big step here.
  let endJerk = NaN, endAccMin = NaN;
  if (duration !== undefined && iPeak > 0) {
    const vAt = (t: number) => { const i = s.findIndex(x => x.t >= t - 1e-6); const x = s[i]; return x?.mom ? x.mom.y / x.mass : NaN; };
    const acc: number[] = [];
    for (let t = Math.ceil((0.6 * duration) / 0.05) * 0.05; t <= s[iPeak]!.t + 1e-6; t += 0.05) acc.push((vAt(t) - vAt(t - 0.05)) / 0.05);
    const f = acc.filter(Number.isFinite);
    if (f.length) endAccMin = r2(Math.min(...f));
    for (let i = 1; i < acc.length; i++) if (Number.isFinite(acc[i]! - acc[i - 1]!)) endJerk = Math.max(Number.isFinite(endJerk) ? endJerk : 0, Math.abs(acc[i]! - acc[i - 1]!));
    endJerk = r2(endJerk);
  }
  // Feet in the first 0.6 s: how far either got from where it stood, at most.
  let footSlide06 = 0;
  for (const x of s) if (x.t <= 0.6 + 1e-6) footSlide06 = Math.max(footSlide06, flat(x.p.footL, s[0]!.p.footL), flat(x.p.footR, s[0]!.p.footR));
  const comProfile: number[] = [];
  for (let t = 0; t <= 1.6; t += 0.1) { const i = s.findIndex(x => x.t >= t - 1e-6); if (i >= 0) comProfile.push(s[i]!.com ? r2(s[i]!.com!.y) : NaN); }
  return {
    hips0: r2(hips0), hipsRest: r2(hipsRest), tHipsFloor: r2(tFloor),
    com0: r2(com0), comRest: r2(comRest), tComFloor: iComFloor >= 0 ? r2(s[iComFloor]!.t) : NaN,
    freeFall19: r2(freeFall), freeFall981: r2(freeFallReal),
    tImpact: iImpact >= 0 ? r2(s[iImpact]!.t) : NaN, comVpeak: r2(vPeak), tVpeak: iPeak >= 0 ? r2(s[iPeak]!.t) : NaN,
    accFirst025: r2(accFirst),
    weightShare: W > 0 ? { gravityCut: r2(gravCut / W), hipHold: r2(hold / W), ligamentPush: r2(lig / W), floor: r2(floor / W), netFall: r2(1 - (gravCut + hold + lig + floor) / W) } : null,
    tKnee035: iKnee >= 0 ? r2(s[iKnee]!.t) : NaN, tChestTilt035: iTilt >= 0 ? r2(s[iTilt]!.t) : NaN, tHipsDrop10cm: iDrop10 >= 0 ? r2(s[iDrop10]!.t) : NaN,
    footSlideAtFloor: r2(footSlide(iFloor)), footSlideRest: r2(footSlide(n - 1)),
    maxKneeFlex: r2(maxKnee), tKneesDown: iKneesDown >= 0 ? r2(s[iKneesDown]!.t) : NaN, onHeelsSeconds: r2(squat),
    lyingSlide: r2(lyingSlide), tLying: iLying >= 0 ? r2(s[iLying]!.t) : NaN, reboundHips: r3(rebound), reboundCom: r3(comRebound), slideAfterImpact: r2(slideAfter), hipsTravel: r2(flat(last.p.hips, s[0]!.p.hips)),
    headArrive: r2(arrive('head')), handLArrive: r2(arrive('handL')), handRArrive: r2(arrive('handR')),
    headPathAfterImpact: r2(headPath), handPathAfterImpact: r2(handPath), headRelPeakAfter: r2(headRelPeak), headMovesUntil: r2(headStop),
    peakHips: r2(peak('hips')), peakChest: r2(peak('chest')), peakHead: r2(peak('head')), peakHand: r2(Math.max(peak('handL'), peak('handR'))),
    tRest01: iRest > 0 ? r2(s[Math.min(iRest, n - 1)]!.t) : NaN, tFreeze: iFreeze > 0 ? r2(s[iFreeze]!.t) : NaN, jitterLast20: r3(jitter),
    lateHipsRise: r2(Math.max(...s.filter(x => x.t >= 1).map(x => x.p.hips.y)) - hipsRest),
    lateMotion: r2((() => { let d = 0; for (let i = 1; i < n; i++) if (s[i]!.t >= 1) for (const k of Object.keys(TRACK) as TrackName[]) d += s[i]!.p[k].distanceTo(s[i - 1]!.p[k]); return d; })()),
    finalKnee: [r2(last.kneeL), r2(last.kneeR)],
    kneeRest: r2(Math.max(last.kneeYL, last.kneeYR)),
    finalHeadToFoot: r2(Math.max(last.p.head.distanceTo(last.p.footL), last.p.head.distanceTo(last.p.footR))),
    finalFootprint: r2((() => { const xs = Object.values(last.p).map(q => q.x), zs = Object.values(last.p).map(q => q.z); return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)); })()),
    meanGravityScaleFirst1s: r2((() => { const w = s.filter(x => x.t <= 1 && x.mass > 0); return w.reduce((a, x) => a + x.gEff, 0) / Math.max(w.length, 1) / -GRAVITY; })()),
    minGravityScale: r2(Math.min(...s.filter(x => x.mass > 0).map(x => x.gEff / -GRAVITY))),
    endJerk, endAccMin, footSlide06: r2(footSlide06),
    lastMove, hipsProfile: profile, comProfile, accProfile,
  };
}

// ------------------------------------------------------------------------------------------------
// Ways to die
// ------------------------------------------------------------------------------------------------
const dmg = (point: THREE.Vector3, dir: THREE.Vector3, amount: number, force: number, type: DamageInfo['type'] = 'bullet', bone?: number): DamageInfo => ({
  amount, type, point: point.clone(), dir: dir.clone(), force, source: 'probe', bone,
});
const FWD = v(0, 0, -1); // shots travel -Z, bodies face +Z (shot in the front)

function kill(kind: string, c: Body): void {
  const chest = pos(c, B.chest).add(v(0, 0.1, 0.12));
  const impulse = (force: number, dir = FWD) => dir.clone().multiplyScalar(force).add(v(0, force * 0.15, 0));
  switch (kind) {
    case 'drop': gore.ragdoll(c); break;
    case 'drop-limp': gore.ragdoll(c, { limp: true }); break;
    case 'drop-hard': gore.ragdoll(c, { muscles: false }); break;
    case 'knock-topple': gore.knockdown(c, { topple: v(0, 0, -1.7), lie: 3, rise: 2, hurt: 0.6 }); break;
    case 'collapse': gore.collapse(c, { duration: 1.1 }); break;
    case 'collapse-smg': gore.collapse(c, { duration: 1.1, hit: { bone: B.chest, point: chest, dir: FWD.clone(), force: 20 } }); break;
    case 'headshot': {
      const head = pos(c, B.head).add(v(0, 0.08, 0.1));
      gore.headshot(c, dmg(head, FWD, 50, 20, 'bullet', B.head));
      break;
    }
    case 'headshot-still': {
      const head = pos(c, B.head).add(v(0, 0.08, 0.1));
      gore.headshot(c, dmg(head, FWD, 50, 20, 'bullet', B.head));
      const m = ragOf(c)!.muscle!; m.twitch = 0;
      break;
    }
    case 'collapse-0.85': gore.collapse(c, { duration: 0.85, hit: { bone: B.chest, point: chest, dir: FWD.clone(), force: 20 } }); break;
    case 'collapse-1.4': gore.collapse(c, { duration: 1.4, hit: { bone: B.chest, point: chest, dir: FWD.clone(), force: 20 } }); break;
    case 'headshot-pop': {
      const head = pos(c, B.head).add(v(0, 0.08, 0.1));
      gore.headshot(c, dmg(head, FWD, 30, 20, 'bullet', B.head));
      break;
    }
    case 'judge': gore.ragdoll(c, { impulses: [{ bone: B.chest, point: chest, impulse: impulse(40) }] }); break;
    case 'shotgun-pb': {
      const f = 18 * 6.6;
      gore.ragdoll(c, { impulses: [{ bone: B.chest, point: chest, impulse: impulse(f) }] });
      for (let i = 1; i < 6; i++) {
        const target = pos(c, [B.chest, B.spine, B.hips][i % 3]!);
        const from = target.clone().add(v(0, 0.2, 3));
        const dir = target.clone().sub(from).normalize();
        const hit = gore.raycastCorpses(from, dir, 6);
        if (hit) gore.damageCorpse(hit, dmg(hit.point, dir, 20, f, 'pellet'));
      }
      break;
    }
    case 'rocket2m': {
      const at = pos(c, B.hips);
      const center = v(at.x, 0.3, at.z + 2);
      const falloff = 1 - 2 / 8;
      const d = pos(c, B.chest).sub(center); d.y += 0.6; d.normalize();
      const force = 0.875 * 12 * 8 * falloff;
      gore.ragdoll(c, { impulses: [{ bone: B.chest, point: chest, impulse: d.clone().multiplyScalar(force).add(v(0, force * 0.15, 0)) }] });
      physics.radialImpulse(center, 8 * 1.35, 12 * 8);
      break;
    }
    default: throw new Error(kind);
  }
}

function death(arch: string, kind: string, yaw = 0, frames = 300): DeathMetrics {
  gore.clear();
  const c = spawn(arch, 0, 0, yaw);
  kill(kind, c);
  const s = record(c, frames);
  const m = deathMetrics(s, COLLAPSE_SECONDS[kind]);
  gore.clear();
  return m;
}

// ------------------------------------------------------------------------------------------------
// Sections
// ------------------------------------------------------------------------------------------------

// ------------------------------------------------------------------------------------------------
// The weight pass: sweeps and acceptance numbers. Tuning is set through these, so the probe still builds against a tree
// that does not have the knobs yet, and then they simply do nothing.
// ------------------------------------------------------------------------------------------------
const HEADINGS = [0, 1.05, 2.1, 3.15, 4.2, 5.25];
const knob = {
  rag: RagTuning as unknown as Record<string, unknown>,
  muscle: MuscleTuning as unknown as Record<string, unknown>,
  gore: GoreTuning as unknown as Record<string, unknown>,
};
const only = (name: string) => { const list = process.env.PROBE_ONLY?.split(','); return !list || list.includes(name); };
/** PROBE_SET=rag.heelFeet=0,muscle.supportFade=0.2:0.6 sets tuning before the sections run. A colon makes a list. */
function applySet(): void {
  for (const item of (process.env.PROBE_SET ?? '').split(',').filter(Boolean)) {
    const [path, raw] = item.split('=') as [string, string];
    const keys = path.split('.');
    let o = knob[keys.shift() as keyof typeof knob] as Record<string, unknown>;
    while (keys.length > 1) o = o[keys.shift()!] as Record<string, unknown>;
    const old = o[keys[0]!];
    o[keys[0]!] = raw.includes(':') ? raw.split(':').map(Number) : typeof old === 'boolean' ? raw === '1' || raw === 'true' : Number(raw);
  }
}

/** Means over headings. An object (weightShare) is averaged field by field, an array of numbers element by element. */
function means(runs: DeathMetrics[], keys: string[]): Record<string, unknown> {
  const avg = (xs: unknown[]) => { const f = xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)); return f.length ? r2(f.reduce((a, b) => a + b, 0) / f.length) : NaN; };
  const mean: Record<string, unknown> = {};
  for (const k of keys) {
    const vals = runs.map(r => r[k]);
    const first = vals.find(x => x !== null && x !== undefined);
    if (typeof first === 'number') mean[k] = avg(vals);
    else if (first && typeof first === 'object' && !Array.isArray(first)) {
      const o: Record<string, number> = {};
      for (const f of Object.keys(first)) o[f] = avg(vals.map(x => (x as Record<string, unknown> | null)?.[f]));
      mean[k] = o;
    } else if (Array.isArray(first) && typeof first[0] === 'number') {
      mean[k] = (first as number[]).map((_, i) => avg(vals.map(x => (x as number[] | undefined)?.[i])));
    } else mean[k] = first;
  }
  return mean;
}
const spreadOf = (runs: DeathMetrics[], k: string) => {
  const f = runs.map(r => r[k]).filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  return f.length ? [r2(Math.min(...f)), r2(Math.max(...f))] : [NaN, NaN];
};

applySet();

if (want('mass')) {
  // Per-body masses and inertia, from the Rag Rapier builds. Human segment data (de Leva 1996, Dempster): trunk ~50%,
  // head+neck ~8%, upper arm 2.7%, forearm 1.6%, hand 0.6%, thigh 14.2% (de Leva) / 10% (Dempster), shank 4.3%, foot 1.4%.
  const res: Record<string, unknown> = {};
  for (const arch of ['husk', 'trooper', 'brute', 'juggernaut']) {
    gore.clear();
    const c = spawn(arch, 0, 0, 0, false);
    gore.ragdoll(c);
    const rag = ragOf(c)!;
    const names = rag.parts.map(p => rigOf(arch).bones[p.bone]!.name);
    const total = rag.parts.reduce((a, p) => a + p.body.mass(), 0);
    const rows: Record<string, unknown> = {};
    rag.parts.forEach((p, i) => {
      const inv = p.body.invPrincipalInertia();
      rows[names[i]!] = { kg: r2(p.body.mass()), share: r3(p.body.mass() / total), I: [r3(1 / inv.x), r3(1 / inv.y), r3(1 / inv.z)] };
    });
    const segs = {
      trunk: ['hips', 'chest'], head: ['head'], armL: ['upperArmL', 'foreArmL'], legL: ['thighL', 'shinL'],
    };
    const shares: Record<string, number> = {};
    for (const [k, list] of Object.entries(segs)) shares[k] = r3(rag.parts.filter((p, i) => list.includes(names[i]!)).reduce((a, p) => a + p.body.mass(), 0) / total);
    res[arch] = { totalKg: r2(total), rigMass: r2(rigInfo(rigOf(arch)).mass), height: rigOf(arch).height, shares, parts: rows };
    gore.clear();
  }
  saveSection('mass', res);
}

if (want('deaths')) {
  const res: Record<string, unknown> = {};
  for (const arch of ['husk', 'trooper', 'brute']) {
    for (const kind of (arch === 'trooper' ? ['drop', 'collapse-0.85', 'collapse-smg', 'collapse-1.4', 'headshot', 'headshot-still', 'headshot-pop', 'judge', 'shotgun-pb', 'rocket2m'] : ['drop', 'collapse-smg', 'headshot', 'headshot-still', 'judge', 'shotgun-pb', 'rocket2m'])) {
      res[`${arch}/${kind}`] = death(arch, kind, 0, 360);
    }
  }
  saveSection('deaths', res);
}

if (want('ab')) {
  // Each knob off in turn, three headings each, mean of the key numbers.
  type Variant = { name: string; set(): void; reset(): void };
  const save = { ...RagTuning };
  const msave = { ...MuscleTuning } as Record<string, unknown>;
  const gsave = { ...GoreTuning };
  const restore = () => {
    Object.assign(RagTuning, save);
    for (const [k, val] of Object.entries(msave)) { try { (MuscleTuning as Record<string, unknown>)[k] = val; } catch { /* getter */ } }
    Object.assign(GoreTuning, gsave);
    noGravityScale = false; substeps = 1; physics.world.numSolverIterations = 4;
    physics.world.gravity = { x: 0, y: GRAVITY, z: 0 };
  };
  const M = MuscleTuning as Record<string, unknown>;
  const variants: Variant[] = [
    { name: 'baseline', set() {}, reset: restore },
    { name: 'jointDamping0', set() { RagTuning.jointDamping = 0; }, reset: restore },
    { name: 'toneDamping0', set() { RagTuning.toneDamping = 0; }, reset: restore },
    { name: 'joint+tone0', set() { RagTuning.jointDamping = 0; RagTuning.toneDamping = 0; }, reset: restore },
    { name: 'angDamp0+linDamp0', set() { RagTuning.angularDamping = 0; RagTuning.linearDamping = 0; }, reset: restore },
    { name: 'ligamentZoneNarrow', set() { M.limitZone = 0.12; M.shoulderZone = 0.12; }, reset: restore },
    { name: 'ligamentDamping0', set() { M.limitDamping = 4; }, reset: restore },
    { name: 'neutralOff', set() { M.neutralCap = 0; }, reset: restore },
    { name: 'noGravityScale', set() { noGravityScale = true; }, reset: restore },
    { name: 'allSyrupOff', set() { RagTuning.jointDamping = 0; RagTuning.toneDamping = 0; RagTuning.angularDamping = 0; M.limitZone = 0.12; M.shoulderZone = 0.12; M.neutralCap = 0; }, reset: restore },
    { name: 'solver8', set() { physics.world.numSolverIterations = 8; }, reset: restore },
    { name: 'substep120', set() { substeps = 2; }, reset: restore },
    { name: 'gravity9.81', set() { physics.world.gravity = { x: 0, y: -9.81, z: 0 }; }, reset: restore },
  ];
  const keys = ['lyingSlide', 'tLying', 'tHipsFloor', 'tComFloor', 'freeFall19', 'tImpact', 'comVpeak', 'accFirst025', 'tKnee035', 'tChestTilt035', 'footSlideAtFloor', 'reboundHips', 'slideAfterImpact', 'headArrive', 'headPathAfterImpact', 'peakHead', 'peakHand', 'tRest01', 'tFreeze'];
  const res: Record<string, Record<string, unknown>> = {};
  for (const kind of ['drop', 'headshot', 'collapse-smg']) {
    for (const variant of variants) {
      variant.set();
      const runs = [0, 2.1, 4.2].map(yaw => death('trooper', kind, yaw, 420));
      variant.reset();
      const mean: Record<string, unknown> = {};
      for (const k of keys) {
        const vals = runs.map(r => r[k] as number).filter(x => Number.isFinite(x));
        mean[k] = vals.length ? r2(vals.reduce((a, b) => a + b, 0) / vals.length) : NaN;
      }
      mean.weightShare = runs[0]!.weightShare;
      (res[kind] ??= {})[variant.name] = mean;
    }
  }
  saveSection('ab', res);
}

if (want('arm')) {
  // A trunk held fixed and one arm let go from horizontal. How long the hand takes to reach the bottom of its swing, and
  // how fast it gets there, against the same arm with every damper and the resting pull off.
  const still = { update() {}, play() { return 0; }, flinch() {}, setLocomotion() {} };
  const M = MuscleTuning as Record<string, unknown>;
  const save = { ...RagTuning };
  const msave = { ...MuscleTuning } as Record<string, unknown>;
  const restore = () => { Object.assign(RagTuning, save); for (const [k, val] of Object.entries(msave)) { try { M[k] = val; } catch { /* getter */ } } };
  const res: Record<string, unknown> = {};
  const cases: [string, () => void][] = [
    ['baseline', () => {}],
    ['baseline-limp(headshot)', () => {}],
    ['jointDamping0', () => { RagTuning.jointDamping = 0; }],
    ['toneDamping0', () => { RagTuning.toneDamping = 0; }],
    ['ligamentZoneNarrow', () => { M.shoulderZone = 0.12; M.limitZone = 0.12; }],
    ['neutralOff', () => { M.neutralCap = 0; }],
    ['allOff', () => { RagTuning.jointDamping = 0; RagTuning.toneDamping = 0; RagTuning.angularDamping = 0; M.shoulderZone = 0.12; M.limitZone = 0.12; M.neutralCap = 0; }],
  ];
  for (const pose of ['forward', 'side']) {
    for (const [name, set] of cases) {
      set();
      gore.clear();
      const c = spawn('trooper', 0, 0, 0, false);
      (c as { anim: unknown }).anim = still;
      // Upper arm horizontal, elbow straight.
      if (pose === 'forward') c.bones[B.upperArmL]!.quaternion.setFromAxisAngle(v(1, 0, 0), -Math.PI / 2);
      else c.bones[B.upperArmL]!.quaternion.setFromAxisAngle(v(0, 0, 1), Math.PI / 2 - 0.35);
      c.bones[B.foreArmL]!.quaternion.identity();
      c.root.updateMatrixWorld(true);
      gore.ragdoll(c, name.includes('limp') ? { limp: true } : undefined);
      const rag = ragOf(c)!;
      for (const p of rag.parts) if (p.bone !== B.upperArmL && p.bone !== B.foreArmL) p.body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
      const shoulder = pos(c, B.upperArmL);
      const hand0 = pos(c, B.handL);
      let t = 0, tBottom = NaN, peak = 0, peakAt = NaN, last = hand0.clone(), lowest = hand0.y;
      const ys: number[] = [];
      for (let f = 1; f <= 90; f++) {
        frame(); t += ctx.time.dt;
        const h = pos(c, B.handL);
        const sp = h.distanceTo(last) / ctx.time.dt;
        if (sp > peak) { peak = sp; peakAt = t; }
        last = h;
        if (h.y < lowest - 1e-4) { lowest = h.y; tBottom = t; }
        if (f % 6 === 0) ys.push(r2(h.y - shoulder.y));
      }
      res[`${pose}/${name}`] = { handStartRelY: r2(hand0.y - shoulder.y), tLowest: r2(tBottom), lowestRelY: r2(lowest - shoulder.y), peakHandSpeed: r2(peak), peakAt: r2(peakAt), handRelY_every0p1s: ys };
      gore.clear();
      restore();
    }
  }
  // The ideal: a rigid two-part arm about a fixed shoulder from horizontal, from Rapier's own masses. Reported for the
  // trooper: reach the bottom in t = quarter period-ish, peak hand speed sqrt(2 g h_c / (I/m)) * L.
  saveSection('arm', res);
}

if (want('hits')) {
  // Hits on a corpse at rest, a dying body and a knocked-down body. Peak speeds of parts, rotation of chest and head.
  const res: Record<string, unknown> = {};
  const parts = { hips: B.hips, chest: B.chest, head: B.head, handR: B.handR, footL: B.footL } as const;
  type PN = keyof typeof parts;
  const watch = (c: Body, frames: number): Record<string, unknown> => {
    const start: Record<string, THREE.Vector3> = {};
    const last: Record<string, THREE.Vector3> = {};
    const peak: Record<string, number> = {};
    for (const k of Object.keys(parts) as PN[]) { start[k] = pos(c, parts[k]); last[k] = start[k]!.clone(); peak[k] = 0; }
    const chestUp0 = upOf(c, B.chest), headUp0 = upOf(c, B.head);
    let chestRot = 0, headRot = 0;
    for (let f = 0; f < frames; f++) {
      frame();
      for (const k of Object.keys(parts) as PN[]) {
        const p = pos(c, parts[k]);
        peak[k] = Math.max(peak[k]!, p.distanceTo(last[k]!) / Math.max(ctx.time.dt, 1e-6));
        last[k] = p;
      }
      chestRot = Math.max(chestRot, upOf(c, B.chest).angleTo(chestUp0));
      headRot = Math.max(headRot, upOf(c, B.head).angleTo(headUp0));
    }
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(parts) as PN[]) o[k] = { peak: r2(peak[k]!), moved: r3(last[k]!.distanceTo(start[k]!)) };
    o.chestRotMax = r3(chestRot); o.headRotMax = r3(headRot);
    return o;
  };
  const shootCorpse = (c: Body, bone: number, amount: number, force: number, type: DamageInfo['type'] = 'bullet', range = 4) => {
    const target = pos(c, bone);
    const from = target.clone().add(v(0, 1.4, range));
    const dir = target.clone().sub(from).normalize();
    const hit = gore.raycastCorpses(from, dir, range + 4);
    if (hit) gore.damageCorpse(hit, dmg(hit.point, dir, amount, force, type));
    return hit ? rigOf(c.archetype).bones[hit.bone]!.name : 'miss';
  };
  for (const arch of ['husk', 'trooper', 'brute', 'juggernaut']) {
    // Corpse at rest.
    const weapons: [string, (c: Body) => string][] = [
      ['wake-only', c => shootCorpse(c, B.chest, 0, 0.001)],
      ['smg-chest', c => shootCorpse(c, B.chest, 25, 20)],
      ['smg-head', c => shootCorpse(c, B.head, 25, 20)],
      ['smg-forearm', c => shootCorpse(c, B.foreArmR, 25, 20)],
      ['smg-thigh', c => shootCorpse(c, B.thighL, 25, 20)],
      ['judge-chest', c => shootCorpse(c, B.chest, 120, 40)],
      ['shotgun-8m', c => { const n: string[] = []; for (let i = 0; i < 6; i++) n.push(shootCorpse(c, [B.chest, B.spine, B.hips, B.chest, B.upperArmR, B.thighL][i]!, 20, 18, 'pellet', 8)); return n.join(','); }],
      ['shotgun-pb', c => { const n: string[] = []; for (let i = 0; i < 6; i++) n.push(shootCorpse(c, [B.chest, B.spine, B.hips, B.chest, B.upperArmR, B.thighL][i]!, 20, 18 * 6.6, 'pellet', 2)); return n.join(','); }],
      ['rocket-3m', c => { const at = pos(c, B.hips); physics.radialImpulse(v(at.x, 0.3, at.z + 3), 8 * 1.35, 12 * 8); return 'blast'; }],
    ];
    for (const [w, fire] of weapons) {
      gore.clear();
      const c = spawn(arch, 0, 0, 0, false);
      gore.ragdoll(c);
      let f = 0;
      while (gore.stats().ragdolls > 0 && f < 600) { frame(); f++; }
      const struck = fire(c);
      res[`corpse/${arch}/${w}`] = { struck, ...watch(c, 60) };
    }
    // Dying on its feet: an SMG round 0.3 s into a 1.1 s collapse, against the same collapse unhit, same heading.
    for (const hitIt of [false, true]) {
      gore.clear();
      const c = spawn(arch, 0, 0, 0, true);
      gore.collapse(c, { duration: 1.1 });
      for (let i = 0; i < 18; i++) frame();
      let struck = 'none';
      if (hitIt) struck = shootCorpse(c, B.chest, 25, 20, 'bullet', 6);
      res[`dying/${arch}/smg-chest-${hitIt ? 'hit' : 'nohit'}`] = { struck, ...watch(c, 18) };
    }
    // A stream of SMG rounds into a dying body at 10 rounds a second, and the same collapse unshot.
    for (const shoot of [false, true]) {
      gore.clear();
      const c = spawn(arch, 0, 0, 0, true);
      gore.collapse(c, { duration: 1.1 });
      const h0 = pos(c, B.hips);
      let rounds = 0;
      for (let i = 0; i < 90; i++) {
        if (shoot && i % 6 === 0 && i < 60) { shootCorpse(c, [B.chest, B.head, B.chest, B.spine][rounds % 4]!, 25, 20, 'bullet', 6); rounds++; }
        frame();
      }
      res[`dying/${arch}/smg-stream-${shoot ? 'shot' : 'unshot'}`] = { rounds, hipsTravel: r2(flat(pos(c, B.hips), h0)) };
    }
    // Knocked down and lying: an SMG round, the way hitWhileDown sends it.
    {
      gore.clear();
      const c = spawn(arch, 0, 0, 0, true);
      gore.knockdown(c, { topple: v(0, 0, -1.8), lie: 3, rise: 2, hurt: 0.6 });
      for (let i = 0; i < 70; i++) frame();
      const target = pos(c, B.chest);
      const from = target.clone().add(v(0, 1.4, 4));
      const dir = target.clone().sub(from).normalize();
      gore.knockdown(c, { impulses: [{ bone: B.chest, point: target, impulse: dir.clone().multiplyScalar(20) }], wound: { bone: B.chest, point: target } });
      res[`down/${arch}/smg-chest`] = watch(c, 18);
    }
  }
  // Rocket on a living body that survives: thrown, lies, gets up.
  for (const arch of ['husk', 'trooper', 'brute']) {
    gore.clear();
    const c = spawn(arch, 0, 0, 0, true);
    gore.knockdown(c, { impact: { dir: v(0, 0, -1), strength: 0.4 }, lie: 1, rise: 2, hurt: 0.6 });
    const at = pos(c, B.hips);
    physics.radialImpulse(v(at.x, 0.3, at.z + 2.5), 8 * 1.35, 12 * 8);
    const h0 = pos(c, B.hips);
    let peakY = 0, airborne = 0, peakSpeed = 0, last = h0.clone();
    let f = 0;
    while (gore.downed(c) && f < 600) {
      frame(); f++;
      const h = pos(c, B.hips);
      peakY = Math.max(peakY, h.y - h0.y);
      peakSpeed = Math.max(peakSpeed, h.distanceTo(last) * 60);
      last = h;
      const feet = Math.min(pos(c, B.footL).y, pos(c, B.footR).y);
      if (feet > 0.15) airborne++;
    }
    res[`survivor/${arch}/rocket-2.5m`] = { thrown: r2(flat(last, h0)), hipsRise: r2(peakY), peakHipsSpeed: r2(peakSpeed), framesFeetOff: airborne, secondsDown: r2(f / 60) };
  }
  saveSection('hits', res);
}

if (want('variants')) {
  // Ankle free, knee hard stop near the rig limit, both. Six headings each, means.
  const M = MuscleTuning as Record<string, unknown>;
  const fold = M.hardMarginFolded;
  const keys = ['tHipsFloor', 'comVpeak', 'accFirst025', 'maxKneeFlex', 'tKneesDown', 'onHeelsSeconds', 'reboundHips', 'reboundCom', 'footSlideRest', 'lyingSlide', 'headArrive', 'handLArrive', 'tRest01', 'tFreeze'];
  const res: Record<string, Record<string, unknown>> = {};
  const cases: [string, () => void][] = [
    ['baseline', () => { rigVariant = ''; M.hardMarginFolded = fold; }],
    ['kneeStop2.45', () => { rigVariant = ''; M.hardMarginFolded = 0.05; }],
    ['ankle', () => { rigVariant = 'ankle'; M.hardMarginFolded = fold; }],
    ['ankle+kneeStop', () => { rigVariant = 'ankle'; M.hardMarginFolded = 0.05; }],
  ];
  for (const arch of ['trooper', 'brute']) {
    for (const kind of ['drop', 'headshot-still', 'judge', 'collapse-smg']) {
      for (const [name, set] of cases) {
        set();
        const runs = [0, 1.05, 2.1, 3.15, 4.2, 5.25].map(yaw => death(arch, kind, yaw, 360));
        const mean: Record<string, unknown> = {};
        for (const k of keys) {
          const vals = runs.map(r => r[k] as number).filter(x => Number.isFinite(x));
          mean[k] = vals.length ? r2(vals.reduce((a, b) => a + b, 0) / vals.length) : NaN;
        }
        mean.n = runs.length;
        (res[`${arch}/${kind}`] ??= {})[name] = mean;
      }
    }
  }
  rigVariant = ''; M.hardMarginFolded = fold;
  saveSection('variants', res);
}

if (want('pose')) {
  const keys = ['tHipsFloor', 'accFirst025', 'maxKneeFlex', 'finalKnee', 'finalHeadToFoot', 'finalFootprint', 'onHeelsSeconds', 'tKneesDown', 'meanGravityScaleFirst1s', 'minGravityScale', 'weightShare', 'tRest01'];
  const res: Record<string, unknown> = {};
  for (const kind of ['drop-hard', 'drop', 'headshot-still', 'judge', 'collapse-smg', 'knock-topple']) {
    const runs = [0, 1.05, 2.1, 3.15, 4.2, 5.25].map(yaw => death('trooper', kind, yaw, 300));
    const mean: Record<string, unknown> = {};
    for (const k of keys) {
      const vals = runs.map(r => r[k]);
      if (typeof vals[0] === 'number') { const f = (vals as number[]).filter(Number.isFinite); mean[k] = f.length ? r2(f.reduce((a, b) => a + b, 0) / f.length) : NaN; }
      else mean[k] = vals[0];
    }
    mean.finalKneeAll = runs.map(r => r.finalKnee);
    res[kind] = mean;
  }
  saveSection('pose', res);
}

if (want('fixes')) {
  const M = MuscleTuning as Record<string, unknown>;
  const fold = M.hardMarginFolded;
  const keys = ['tHipsFloor', 'accFirst025', 'comVpeak', 'tKnee035', 'tChestTilt035', 'maxKneeFlex', 'tKneesDown', 'onHeelsSeconds', 'reboundHips', 'footSlideRest', 'lyingSlide', 'finalHeadToFoot', 'meanGravityScaleFirst1s', 'tRest01'];
  const res: Record<string, Record<string, unknown>> = {};
  const reset = () => { rigVariant = ''; M.hardMarginFolded = fold; cutKeep = 1; physics.world.gravity = { x: 0, y: GRAVITY, z: 0 }; };
  const only = process.env.PROBE_ONLY?.split(',');
  const cases0: [string, string[], () => void][] = [
    ['baseline', ['drop', 'headshot-still', 'judge', 'collapse-smg'], () => {}],
    ['ankle', ['drop', 'headshot-still', 'judge', 'collapse-smg'], () => { rigVariant = 'ankle'; }],
    ['ankle+kneeStop', ['drop', 'headshot-still', 'judge'], () => { rigVariant = 'ankle'; M.hardMarginFolded = 0.05; }],
    ['gravity13', ['drop', 'headshot-still', 'judge'], () => { physics.world.gravity = { x: 0, y: -13, z: 0 }; }],
    ['gravity9.81', ['drop', 'headshot-still'], () => { physics.world.gravity = { x: 0, y: -9.81, z: 0 }; }],
    ['heel', ['drop', 'headshot-still', 'judge', 'collapse-smg'], () => { rigVariant = 'heel'; }],
    ['ankle+gravity13', ['drop', 'headshot-still', 'judge'], () => { rigVariant = 'ankle'; physics.world.gravity = { x: 0, y: -13, z: 0 }; }],
    ['heel+gravity13', ['drop', 'headshot-still', 'judge'], () => { rigVariant = 'heel'; physics.world.gravity = { x: 0, y: -13, z: 0 }; }],
    ['heel+gravity11', ['drop', 'headshot-still', 'judge', 'collapse-smg'], () => { rigVariant = 'heel'; physics.world.gravity = { x: 0, y: -11, z: 0 }; }],
    ['heel+gravity9.81', ['drop', 'headshot-still', 'judge', 'collapse-smg'], () => { rigVariant = 'heel'; physics.world.gravity = { x: 0, y: -9.81, z: 0 }; }],
    ['cutKeep0.5', ['collapse-smg'], () => { cutKeep = 0.5; }],
    ['cutKeep0.25', ['collapse-smg'], () => { cutKeep = 0.25; }],
    ['cutKeep0', ['collapse-smg'], () => { cutKeep = 0; }],
    ['ankle+cutKeep0.5', ['collapse-smg'], () => { rigVariant = 'ankle'; cutKeep = 0.5; }],
  ];
  const cases = only ? cases0.filter(c => only.includes(c[0])) : cases0;
  for (const [name, kinds, set] of cases) {
    for (const kind of kinds) {
      set();
      const runs = [0, 1.05, 2.1, 3.15, 4.2, 5.25].map(yaw => death('trooper', kind, yaw, 300));
      reset();
      const mean: Record<string, unknown> = {};
      for (const k of keys) {
        const f = runs.map(r => r[k] as number).filter(Number.isFinite);
        mean[k] = f.length ? r2(f.reduce((a, b) => a + b, 0) / f.length) : NaN;
      }
      (res[kind] ??= {})[name] = mean;
    }
  }
  saveSection('fixes', res);
}

if (want('twitch')) {
  const res: Record<string, unknown> = {};
  for (const arch of ['husk', 'trooper', 'brute']) for (const kind of ['headshot', 'headshot-still', 'headshot-pop', 'drop']) {
    const runs = [0, 1.05, 2.1, 3.15, 4.2, 5.25].map(yaw => death(arch, kind, yaw, 330));
    const m = (k: string) => r2(runs.reduce((a, r) => a + (r[k] as number), 0) / runs.length);
    res[`${arch}/${kind}`] = { lateHipsRiseMean: m('lateHipsRise'), lateHipsRiseMax: r2(Math.max(...runs.map(r => r.lateHipsRise as number))), lateMotionMean: m('lateMotion'), tRest01: m('tRest01'), tFreeze: m('tFreeze') };
  }
  saveSection('twitch', res);
}

if (want('trace')) {
  // Frame by frame around a landing, to see what lifts the hips after they first touch.
  const res: Record<string, unknown> = {};
  for (const kind of ['headshot-still', 'judge', 'drop', 'shotgun-pb']) {
    gore.clear();
    const c = spawn('trooper', 0, 0, 0);
    kill(kind, c);
    const rows: string[] = [];
    let t = 0;
    for (let f = 1; f <= 60; f++) {
      frame(); t += ctx.time.dt;
      if (f < 14 || f % 2) continue;
      const rag = ragOf(c)!;
      const hips = rag.parts[0]!;
      const w = hips.body.angvel();
      const lv = hips.body.linvel();
      const y = (b: number) => pos(c, b).y.toFixed(2);
      const fwd = v(0, 0, 1).applyQuaternion(c.bones[B.chest]!.getWorldQuaternion(new THREE.Quaternion()));
      rows.push(`t${t.toFixed(2)} hips ${y(B.hips)} chest ${y(B.chest)} head ${y(B.head)} kneeL ${y(B.shinL)} kneeR ${y(B.shinR)} footL ${y(B.footL)} handL ${y(B.handL)} | hipsVy ${lv.y.toFixed(2)} hipsW ${Math.hypot(w.x, w.y, w.z).toFixed(1)} chestTilt ${upOf(c, B.chest).angleTo(v(0, 1, 0)).toFixed(2)} chestFwdY ${fwd.y.toFixed(2)} kneeFlexL ${knee(c, B.shinL).toFixed(2)}`);
    }
    res[kind] = rows;
    gore.clear();
  }
  saveSection('trace', res);
}

if (want('flinch')) {
  // A standing living body is the animator's: how far one round tips its chest and head through `flinch`. Read against a
  // twin that was not hit, started from the same animator state, so the idle's own sway does not count. `chestTilt` is
  // signed along the shot: past rest the other way is the overshoot. The size of the flinch is the damage model's own
  // (`flinchSize`, falling back to the formula from before stage 3 on a tree without it).
  const res: Record<string, unknown> = {};
  const sizeOf = (damageModel as { flinchSize?: (frac: number) => number }).flinchSize ?? ((frac: number) => Math.min(1.6, Math.max(0.35, 0.35 + frac * 3)));
  const living = (arch: string): Body => {
    const rig = rigOf(arch);
    const c = new TestDummy(rig) as Body;
    scene.add(c.root);
    (c as { anim: unknown }).anim = new HumanoidAnimator(c.bones, rig, archetypeById(arch), c.root, c.severed, b => hiddenOf(c)[b] === 1);
    return c;
  };
  const step = (c: Body) => {
    const anim = c.anim as HumanoidAnimator;
    anim.setLocomotion({ speed: 0, moveX: 0, moveZ: 1, aimYaw: 0, aimPitch: 0, grounded: true } as never);
    anim.update(1 / 60, 0);
    c.root.updateMatrixWorld(true);
  };
  const cases: [string, string, number][] = [['husk', 'husk', 25], ['trooper', 'trooper', 25], ['brute', 'brute', 25], ['trooper-judge', 'trooper', 120]];
  for (const [name, arch, amount] of cases) {
    const c = living(arch);
    const ref = living(arch);
    const a = c.anim as unknown as Record<string, number>;
    const b = ref.anim as unknown as Record<string, number>;
    b.time = a.time!; b.seed = a.seed!; b.tickCount = a.tickCount!;
    for (let i = 0; i < 30; i++) { step(c); step(ref); }
    const frac = Math.min(1, amount / ENEMIES[arch as keyof typeof ENEMIES].hp);
    const mag = sizeOf(frac);
    (c.anim as HumanoidAnimator).flinch(B.chest, FWD, mag);
    const tilt: number[] = [];
    let chestRot = 0, headRot = 0, headPeak = 0, lastHead = pos(c, B.head);
    const cross = v(0, 0, 0), axis = v(0, 0, 0);
    for (let i = 0; i < 60; i++) {
      step(c); step(ref);
      const u = upOf(c, B.chest), u0 = upOf(ref, B.chest);
      axis.crossVectors(u0, FWD).normalize();
      tilt.push(Math.atan2(cross.crossVectors(u0, u).dot(axis), u0.dot(u)));
      chestRot = Math.max(chestRot, u.angleTo(u0));
      headRot = Math.max(headRot, upOf(c, B.head).angleTo(upOf(ref, B.head)));
      const h = pos(c, B.head); headPeak = Math.max(headPeak, h.distanceTo(lastHead) * 60); lastHead = h;
    }
    let iPeak = 0;
    for (let i = 1; i < tilt.length; i++) if (tilt[i]! > tilt[iPeak]!) iPeak = i;
    const peak = tilt[iPeak]!;
    const back = Math.min(0, ...tilt.slice(iPeak));
    let settled = tilt.length;
    while (settled > 0 && Math.abs(tilt[settled - 1]!) < 0.02) settled--;
    res[name] = {
      magnitude: r2(mag), chestTilt: r3(peak), tPeak: r2((iPeak + 1) / 60), overshoot: r3(-back), overshootShare: r2(-back / Math.max(peak, 1e-6)),
      tiltAt05: r3(Math.abs(tilt[29]!)), within002From: r2(settled / 60), chestRot: r3(chestRot), headRot: r3(headRot), headPeakSpeed: r2(headPeak),
    };
    scene.remove(c.root, ref.root);
  }
  saveSection('flinch', res);
}

if (want('hitmass')) {
  // Stage 3: a round shows the mass of what it hits. PROBE_ROUNDS rounds (default 2) of six headings, each case:
  // - down: knocked down and lying, one SMG round the way `hitWhileDown` sends it, with a wound for a hand to go to. Also the
  //   round alone, the wound alone and neither, since the reach to a wound moves a long arm further than any round, and a
  //   body lying there stirs by itself, so what the round does is `shot` against `none`. Hands, 0.3 s on.
  // - forearm: a corpse at rest, one SMG round that really lands on its right forearm. The hand, 1 s on.
  // - rocket: a corpse at rest, a rocket on the floor 3 m away. Peak hand speed over peak hips speed, 1 s on.
  const rounds = Number(process.env.PROBE_ROUNDS ?? 2);
  const res: Record<string, unknown> = {};
  const stat = (xs: number[]) => {
    const f = xs.filter(Number.isFinite).sort((a, b) => a - b);
    if (!f.length) return null;
    return { mean: r3(f.reduce((s, x) => s + x, 0) / f.length), median: r3((f[(f.length - 1) >> 1]! + f[f.length >> 1]!) / 2), min: r3(f[0]!), max: r3(f.at(-1)!), n: f.length };
  };
  const corpse = (arch: string, yaw: number): Body => {
    gore.clear();
    const c = spawn(arch, 0, 0, yaw, false);
    gore.ragdoll(c);
    let f = 0;
    while (gore.stats().ragdolls > 0 && f < 600) { frame(); f++; }
    return c;
  };
  const peakOf = (c: Body, bones: number[], frames: number) => {
    const last = bones.map(b => pos(c, b));
    const start = last.map(p => p.clone());
    const peak = bones.map(() => 0);
    for (let f = 0; f < frames; f++) {
      frame();
      bones.forEach((b, i) => { const p = pos(c, b); peak[i] = Math.max(peak[i]!, p.distanceTo(last[i]!) / ctx.time.dt); last[i] = p; });
    }
    return { peak, moved: last.map((p, i) => p.distanceTo(start[i]!)) };
  };
  for (const arch of ['husk', 'trooper', 'brute', 'juggernaut']) {
    // `down` is shot 70 frames after the knockdown, as the `hits` section does, which on a big body is still the fall;
    // `lying` 150 frames after, with longer on the floor, once it lies there.
    for (const [when, at, lie] of [['down', 70, 3], ['lying', 150, 4]] as const) for (const variant of ['shot+wound', 'shot', 'wound', 'none']) {
      const handR: number[] = [], hand: number[] = [];
      for (let r = 0; r < rounds; r++) for (const yaw of HEADINGS) {
        gore.clear();
        const c = spawn(arch, 0, 0, yaw, true);
        gore.knockdown(c, { topple: v(0, 0, -1.8), lie, rise: 2, hurt: 0.6 });
        for (let i = 0; i < at; i++) frame();
        const target = pos(c, B.chest);
        const dir = target.clone().sub(target.clone().add(v(0, 1.4, 4))).normalize();
        const options: NonNullable<Parameters<Gore['knockdown']>[1]> = {};
        if (variant.startsWith('shot')) options.impulses = [{ bone: B.chest, point: target, impulse: dir.clone().multiplyScalar(20) }];
        if (variant.endsWith('wound')) options.wound = { bone: B.chest, point: target };
        gore.knockdown(c, options);
        const { moved } = peakOf(c, [B.handL, B.handR], 18);
        handR.push(moved[1]!);
        hand.push(Math.max(moved[0]!, moved[1]!));
      }
      gore.clear();
      res[`${when}/${arch}/${variant}`] = { handR: stat(handR), hand: stat(hand) };
    }
    {
      const handR: number[] = [], peakR: number[] = [];
      let misses = 0;
      for (let r = 0; r < rounds; r++) for (const yaw of HEADINGS) {
        const c = corpse(arch, yaw);
        const mid = pos(c, B.foreArmR).add(pos(c, B.handR)).multiplyScalar(0.5);
        let hit: ReturnType<Gore['raycastCorpses']> = null;
        let dir = v(0, -1, 0);
        for (const off of [v(0, 3, 0.4), v(0.4, 3, 0), v(-0.4, 3, 0), v(0, 3, -0.4), v(1.5, 1.5, 0), v(-1.5, 1.5, 0), v(0, 1.5, 1.5), v(0, 1.5, -1.5)]) {
          dir = mid.clone().sub(off.clone().add(mid)).normalize();
          const h = gore.raycastCorpses(mid.clone().add(off), dir, off.length() + 1);
          if (h && h.bone === B.foreArmR) { hit = h; break; }
        }
        if (!hit) { misses++; continue; }
        gore.damageCorpse(hit, dmg(hit.point, dir, 25, 20));
        const { peak, moved } = peakOf(c, [B.handR], 60);
        handR.push(moved[0]!);
        peakR.push(peak[0]!);
      }
      gore.clear();
      res[`forearm/${arch}`] = { handR: stat(handR), peakHandR: stat(peakR), misses };
    }
    {
      const ratio: number[] = [], ratioR: number[] = [], hips: number[] = [];
      for (let r = 0; r < rounds; r++) for (const yaw of HEADINGS) {
        const c = corpse(arch, yaw);
        const at = pos(c, B.hips);
        physics.radialImpulse(v(at.x, 0.3, at.z + 3), 8 * 1.35, 12 * 8);
        const { peak } = peakOf(c, [B.hips, B.handL, B.handR], 60);
        hips.push(peak[0]!);
        ratio.push(Math.max(peak[1]!, peak[2]!) / peak[0]!);
        ratioR.push(peak[2]! / peak[0]!);
      }
      gore.clear();
      res[`rocket/${arch}`] = { handOverHips: stat(ratio), handROverHips: stat(ratioR), hipsPeak: stat(hips) };
    }
  }
  saveSection('hitmass', res);
}

if (want('sweep')) {
  // 1.2: the knee's hard stop at the folded end, with the heel ball on. `today` is the heel off at 0.5.
  const keys = ['finalHeadToFoot', 'onHeelsSeconds', 'tKneesDown', 'maxKneeFlex', 'tHipsFloor', 'tRest01', 'accFirst025', 'comVpeak', 'finalFootprint', 'reboundHips', 'footSlideRest'];
  // A braking zone before the stop (60 and 120 1/s from 2.1 rad) was tried as well, at 0.2, 0.35 and 0.5. It laid no body
  // out longer, slowed the drop and propped more bodies in a kneel, so it did not ship. See docs/notes/gore.md.
  const was = { heel: knob.rag.heelFeet, margin: knob.muscle.kneeMarginFolded };
  const cases: [string, boolean, number][] = [['today', false, 0.5], ['heel+0.5', true, 0.5], ['heel+0.35', true, 0.35], ['heel+0.2', true, 0.2], ['heel+0.1', true, 0.1]];
  const res: Record<string, Record<string, unknown>> = {};
  for (const [name, heel, margin] of cases) {
    if (!only(name)) continue;
    knob.rag.heelFeet = heel;
    knob.muscle.kneeMarginFolded = margin;
    const row: Record<string, unknown> = {};
    for (const arch of ['trooper', 'brute']) {
      const reach: number[] = [];
      for (const kind of ['drop', 'headshot-still', 'judge']) {
        const runs = HEADINGS.map(yaw => death(arch, kind, yaw, 300));
        const m = means(runs, keys);
        reach.push(m.finalHeadToFoot as number);
        row[`${arch}/${kind}`] = { ...m, headToFootRange: spreadOf(runs, 'finalHeadToFoot'), onHeelsRange: spreadOf(runs, 'onHeelsSeconds'), kneesDownRange: spreadOf(runs, 'tKneesDown') };
      }
      row[`${arch}/headToFootMean`] = r2(reach.reduce((a, b) => a + b, 0) / reach.length);
    }
    res[name] = row;
  }
  knob.rag.heelFeet = was.heel;
  knob.muscle.kneeMarginFolded = was.margin;
  saveSection('sweep', res);
}

if (want('freeze')) {
  // A Judge kill, run until the body freezes: where its knees are then. Above 0.25 m it froze kneeling.
  const res: Record<string, unknown> = {};
  let high = 0;
  let n = 0;
  for (const arch of ['husk', 'trooper', 'brute']) {
    const rows: unknown[] = [];
    for (const yaw of HEADINGS) {
      gore.clear();
      const c = spawn(arch, 0, 0, yaw);
      kill('judge', c);
      let f = 0;
      while (ragOf(c)?.active && f < 60 * 8) { frame(); f++; }
      const kneeY = Math.max(pos(c, B.shinL).y, pos(c, B.shinR).y);
      if (kneeY > 0.25) high++;
      n++;
      rows.push({ yaw, frozenAt: r2(f / 60), knee: r2(kneeY), hips: r2(pos(c, B.hips).y), head: r2(pos(c, B.head).y) });
      gore.clear();
    }
    res[arch] = rows;
  }
  res.kneeAbove025 = `${high} of ${n}`;
  saveSection('freeze', res);
}

if (want('collapse')) {
  // 1.5: a collapse under its own weight. trunkCut is the share of a working drive's gravity cut the trunk keeps.
  const keys = ['meanGravityScaleFirst1s', 'weightShare', 'accFirst025', 'comVpeak', 'tKnee035', 'endJerk', 'endAccMin', 'tHipsFloor', 'footSlide06', 'footSlideRest', 'tRest01', 'hipsProfile', 'accProfile'];
  const was = knob.muscle.trunkCut;
  const cuts = (process.env.PROBE_CUTS ?? String(was ?? 1)).split(',').map(Number);
  const res: Record<string, Record<string, unknown>> = {};
  for (const cut of cuts) {
    knob.muscle.trunkCut = cut;
    const row: Record<string, unknown> = {};
    for (const arch of ['trooper', 'brute']) {
      for (const kind of ['collapse-smg', 'collapse-0.85', 'collapse-1.4', 'collapse']) {
        const runs = HEADINGS.map(yaw => death(arch, kind, yaw, 300));
        row[`${arch}/${kind}`] = { ...means(runs, keys), endJerkRuns: runs.map(r => r.endJerk), endJerkRange: spreadOf(runs, 'endJerk'), footSlide06Range: spreadOf(runs, 'footSlide06') };
      }
    }
    res[`trunkCut${cut}`] = row;
  }
  knob.muscle.trunkCut = was;
  saveSection('collapse', res);
}

if (want('tempo')) {
  // Stage 2: the tempo dial, `RagTuning.gravityScale`. PROBE_DIALS=1,0.75,0.6 are the dials, each against the same cases.
  // Plain deaths, six headings each, run until they freeze. Collapses three rounds of six, for the feet. `leap` is a body
  // killed falling at 6 m/s from 1.2 m up, which keeps full gravity until it lands. A body hangs if it has not frozen in
  // 8 s, or froze with its hips above 0.35 m.
  const keys = ['tHipsFloor', 'accFirst025', 'comVpeak', 'reboundHips', 'lyingSlide', 'tRest01', 'tFreeze', 'onHeelsSeconds', 'tKneesDown', 'finalHeadToFoot', 'hipsRest', 'footSlideRest', 'hipsTravel'];
  const dials = (process.env.PROBE_DIALS ?? '1,0.75,0.6').split(',').map(Number);
  const was = knob.rag.gravityScale;
  const res: Record<string, Record<string, unknown>> = {};
  const frames = 60 * 8;
  const leap = (arch: string, yaw: number): DeathMetrics => {
    gore.clear();
    const c = spawn(arch, 0, 0, yaw);
    c.root.position.y = 1.2;
    c.root.updateMatrixWorld(true);
    gore.ragdoll(c, { velocity: v(Math.sin(yaw) * 2, -6, Math.cos(yaw) * 2) });
    const m = deathMetrics(record(c, frames));
    gore.clear();
    return m;
  };
  for (const dial of dials) {
    knob.rag.gravityScale = dial;
    const row: Record<string, unknown> = {};
    const hung: string[] = [];
    const kneel: string[] = [];
    let n = 0;
    const tally = (runs: DeathMetrics[], name: string) => {
      runs.forEach((r, i) => {
        n++;
        if (!Number.isFinite(r.tFreeze as number) || (r.hipsRest as number) > 0.35) hung.push(`${name} ${i} hips ${r.hipsRest} frozen ${r.tFreeze}`);
        // As the freeze section counts it: at rest with a knee above 0.25 m.
        if ((r.kneeRest as number) > 0.25) kneel.push(`${name} ${i} knee ${r.kneeRest}`);
      });
    };
    for (const arch of ['trooper', 'brute']) {
      for (const kind of ['drop', 'headshot-still', 'judge', 'leap']) {
        const runs = HEADINGS.map(yaw => (kind === 'leap' ? leap(arch, yaw) : death(arch, kind, yaw, frames)));
        tally(runs, `${arch}/${kind}`);
        row[`${arch}/${kind}`] = { ...means(runs, keys), tHipsFloorRange: spreadOf(runs, 'tHipsFloor'), onHeelsRange: spreadOf(runs, 'onHeelsSeconds'), tRestRange: spreadOf(runs, 'tRest01') };
      }
      const runs: DeathMetrics[] = [];
      for (let round = 0; round < 3; round++) for (const yaw of HEADINGS) runs.push(death(arch, 'collapse-smg', yaw, frames));
      tally(runs, `${arch}/collapse-smg`);
      const slides = runs.map(r => r.footSlide06 as number).sort((a, b) => a - b);
      row[`${arch}/collapse-smg`] = { ...means(runs, [...keys, 'footSlide06']), footSlide06Median: r2((slides[8]! + slides[9]!) / 2), footSlideRestRange: spreadOf(runs, 'footSlideRest') };
    }
    row.hung = `${hung.length} of ${n}`;
    row.hungCases = hung;
    row.kneeling = `${kneel.length} of ${n}`;
    row.kneelCases = kneel;
    res[`dial${dial}`] = row;
  }
  knob.rag.gravityScale = was;
  saveSection('tempo', res);
}
