/**
 * The player's mortar teams (docs/proposals/outpost-defense.md, piece 8): bought at the Barracks, posted at the fort's mortar posts in
 * the middle ring's yards, out of sight. Each drops a round on the field every so often, at random but weighted toward groups and
 * vehicles (`pickMortarTarget`), never inside the walls. A round climbs out of the tube with a thump, arcs over with a smoke trail,
 * whistles down and lands like an ally's rocket: on the enemy only, never on the player or his men. They do not fight anything near
 * them; a team is a tube, two crates and a beacon.
 */
import * as THREE from 'three';
import type { Ctx, DamageInfo } from '../../core/contracts';
import { CG } from '../../core/contracts';
import type { EnemyInstance } from '../../core/gameplay';
import { rand } from '../../core/math';
import type { EnemyManager } from '../../enemies/EnemyManager';
import { ModelBuilder, ModelMaterials } from '../../progression/modelkit';
import { FORT_POSTS, type FortPost } from '../../world/map/fort/plan';
import { pickMortarTarget, TEAM_MORTAR, type MortarCandidate } from './field';
import { Shells, type Shell } from './shells';

export const TEAM_SOURCE = 'ally_mortar';
const BLAST_IMPULSE = 12;
const BEACON = 0x39e0ff;

const _a = new THREE.Vector3();
const _n = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

interface Team {
  post: FortPost;
  root: THREE.Group;
  fireAt: number;
  rounds: number;
}

export class MortarTeams {
  readonly teams: Team[] = [];
  readonly shells: Shells;
  /** Rounds fired this run, and kills they made, for the bot and the notes. */
  fired = 0;
  private readonly posts: readonly FortPost[];
  private materials: ModelMaterials | null = null;
  private readonly spare: THREE.Group[] = [];
  private readonly candidates: MortarCandidate[] = [];
  private readonly hits: EnemyInstance[] = [];
  private readonly damage: DamageInfo = { amount: 0, type: 'explosive', point: new THREE.Vector3(), dir: new THREE.Vector3(), force: 0, source: TEAM_SOURCE };

  constructor(private readonly ctx: Ctx, onFort: boolean) {
    this.posts = onFort ? FORT_POSTS.filter(p => p.type === 'mortar') : [];
    this.shells = new Shells(ctx, s => this.burst(s), () => {});
  }

  get count(): number {
    return this.teams.length;
  }

  get max(): number {
    return this.posts.length;
  }

  /** A new team at the next empty post. Returns why not, or null. */
  add(): string | null {
    const post = this.posts[this.teams.length];
    if (!post) return this.posts.length ? 'Every post is manned' : 'No mortar posts here';
    const root = this.spare.pop() ?? this.model();
    root.position.set(post.pos[0], post.pos[1], post.pos[2]);
    root.rotation.y = post.yaw;
    root.visible = true;
    // The first round goes soon, so the purchase is heard.
    this.teams.push({ post, root, fireAt: this.ctx.time.elapsed + rand(2, 4), rounds: 0 });
    this.ctx.audio.play('weapon_draw_heavy', { position: root.position });
    return null;
  }

  reset(): void {
    for (const t of this.teams) {
      t.root.visible = false;
      this.spare.push(t.root);
    }
    this.teams.length = 0;
    this.shells.reset();
    this.fired = 0;
  }

  /** `fighting` is false in a break: the field is empty and the crews rest. */
  update(fighting: boolean): void {
    this.shells.update();
    if (!fighting) return;
    const now = this.ctx.time.elapsed;
    for (const t of this.teams) {
      if (now < t.fireAt) continue;
      t.fireAt = now + rand(TEAM_MORTAR.every[0], TEAM_MORTAR.every[1]);
      this.gather();
      pickMortarTarget(this.candidates, Math.random, _a);
      const nav = this.ctx.world.nav;
      nav.nearest(_a, 4, _a);
      // `nearest` can pull a point back toward the fence, never inside it: the walls stand between.
      _n.set(t.post.pos[0], t.post.pos[1] + 1.2, t.post.pos[2]);
      if (this.shells.fire(_n, _a, { radius: TEAM_MORTAR.radius, damage: TEAM_MORTAR.damage, source: TEAM_SOURCE, ring: null, flight: TEAM_MORTAR.flight })) {
        t.rounds++;
        this.fired++;
      }
    }
  }

  /** Everything out in the field worth a round: men on the ground and vehicles. */
  private gather(): void {
    const list = this.candidates;
    list.length = 0;
    for (const e of this.ctx.enemies.alive) {
      if (!e.alive) continue;
      list.push({ x: e.position.x, z: e.position.z, vehicle: false });
    }
    const v = (this.ctx.enemies as EnemyManager).vehicles;
    if (v) for (const x of v.live) if (x.alive && !x.retired && x.def.kind !== 'chopper') list.push({ x: x.position.x, z: x.position.z, vehicle: true });
  }

  /** An ally's blast (allies/fire.ts): on the enemy and his machines, never on the player or an ally. */
  private burst(s: Shell): void {
    const { ctx } = this;
    const { fx, audio, physics } = ctx;
    const p = s.to;
    fx.explosion(p, { radius: s.radius, kind: 'rocket' });
    audio.play('rocket_explosion', { position: p, pitch: 0.8, pitchJitter: 0.05 });
    ctx.camera.addTrauma(Math.max(0, 0.35 - ctx.player.position.distanceTo(p) / 200));
    const n = ctx.enemies.query(p, s.radius + 1.5, this.hits);
    for (let i = 0; i < n; i++) {
      const e = this.hits[i]!;
      if (!e.alive) continue;
      _a.copy(e.center);
      const dist = _a.distanceTo(p);
      if (dist > s.radius) continue;
      _n.subVectors(_a, p);
      if (dist > 0.1) {
        _n.divideScalar(dist);
        if (physics.raycast(p, _n, dist, CG.World)) continue;
      } else _n.copy(_up);
      const d = this.damage;
      d.amount = s.damage * (1 - (dist / s.radius) * 0.5);
      d.point.copy(e.center);
      d.dir.copy(_n).add(_up).normalize();
      d.force = BLAST_IMPULSE * s.radius * (1 - dist / s.radius);
      d.region = undefined;
      d.bone = undefined;
      d.blastKind = 'rocket';
      d.reach = dist / s.radius;
      ctx.enemies.applyDamage(e, d);
    }
    (ctx.enemies as EnemyManager).vehicles?.blast(p, { radius: s.radius, damage: s.damage, kind: 'rocket', source: TEAM_SOURCE, team: 'player' });
    // Shacks and sandbags out there are fair game: they are the enemy's cover.
    ctx.world.objects.damageExplosivesInRadius(p, s.radius, s.damage, TEAM_SOURCE);
    physics.radialImpulse(p, s.radius * 1.35, BLAST_IMPULSE * s.radius);
  }

  private model(): THREE.Group {
    this.materials ??= new ModelMaterials(this.ctx);
    const b = new ModelBuilder()
      .cyl(0.42, 0.46, 0.06, 10, 0x1a1e24, { at: [0, 0.03, 0] })
      .cyl(0.065, 0.075, 1.3, 10, 0x39452e, { at: [0, 0.68, -0.24], rot: [0.42, 0, 0] })
      .box(0.03, 0.74, 0.03, 0x3a4048, { at: [0.18, 0.37, -0.28], rot: [-0.32, 0, -0.1] })
      .box(0.03, 0.74, 0.03, 0x3a4048, { at: [-0.18, 0.37, -0.28], rot: [-0.32, 0, 0.1] })
      .box(0.52, 0.22, 0.32, 0x45503a, { at: [0.9, 0.11, 0.2], rot: [0, 0.4, 0] })
      .box(0.52, 0.22, 0.32, 0x45503a, { at: [0.82, 0.33, 0.18], rot: [0, 0.2, 0] })
      .box(0.03, 1.4, 0.03, 0x3a4048, { at: [-0.7, 0.7, 0.3] })
      .glow(new THREE.SphereGeometry(0.06, 8, 6), BEACON, 4, { at: [-0.7, 1.42, 0.3] });
    const g = this.materials.group(b);
    this.ctx.render.scene.add(g);
    return g;
  }
}
