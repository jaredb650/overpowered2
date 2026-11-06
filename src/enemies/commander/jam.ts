/**
 * What the sonar and the minimap are allowed to say. Three things lie to them: a jammer scrambles everything past a short range, a
 * decoy beacon shows a man who is not there, and a hider under a foil blanket does not show until the ping is close.
 *
 * `render.highlight` is the one door the sonar's picture goes through, so this wraps it for the life of the contract, the way the lab
 * wraps `hud.pause`: `src/contracts/sonar.ts` was out of bounds for this work, and a one-line filter there would be cleaner.
 *
 * The jammer himself always shows, in cyan, through anything. He is a transmitter and the ping is a receiver, and it is the tell: the
 * thing wrecking your sonar is also the one thing it can still find.
 */
import * as THREE from 'three';
import { SONAR } from '../../contracts/data';
import type { EnemyInstance } from '../../core/gameplay';
import { rand, TAU } from '../../core/math';
import { soldierOf } from '../outpost/soldier';
import type { Commander } from './index';
import { unitOf } from './units';

/** Metres the sonar still sees under a jammer. */
const JAM_CLEAR = 13;
/** Inside this a ping finds a man under foil. */
const HIDER_CLEAR = 10;
const REFRESH = 0.25;
/** Blips a jammer invents. */
const STATIC_BLIPS = 5;
const STATIC_RANGE: readonly [number, number] = [14, 40];
const JAMMER_COLOR = '#39e0ff';

type Highlight = (meshes: readonly THREE.Object3D[], color: THREE.ColorRepresentation, strength?: number) => void;

interface Blip {
  uid: number;
  alive: boolean;
  isBoss: boolean;
  position: THREE.Vector3;
}

export class SonarJam {
  /** Meshes the sonar must not light right now. */
  private readonly hidden = new Set<THREE.Object3D>();
  private readonly lit: THREE.Object3D[] = [];
  private readonly ghosts: THREE.Object3D[] = [];
  private readonly operators: THREE.Object3D[] = [];
  private readonly radarList: (EnemyInstance | Blip)[] = [];
  private readonly noise: Blip[] = Array.from({ length: STATIC_BLIPS }, (_, i) => ({ uid: -1 - i, alive: true, isBoss: false, position: new THREE.Vector3() }));
  private readonly beacons: Blip[] = [];
  private refreshAt = 0;
  private shuffleAt = 0;
  jammed = false;

  constructor(private readonly c: Commander) {}

  /** Wraps the sonar's only way of drawing. Once, for the life of the page. */
  init(): void {
    const { render } = this.c.w.ctx;
    // A headless run has no picture to protect.
    if (typeof render.highlight !== 'function') return;
    const base: Highlight = render.highlight.bind(render);
    render.highlight = (meshes, color, strength) => {
      if (this.hidden.size === 0) {
        base(meshes, color, strength);
        return;
      }
      const lit = this.lit;
      lit.length = 0;
      for (let i = 0; i < meshes.length; i++) if (!this.hidden.has(meshes[i]!)) lit.push(meshes[i]!);
      base(lit, color, strength);
    };
  }

  reset(): void {
    this.hidden.clear();
    this.jammed = false;
    this.refreshAt = this.shuffleAt = 0;
  }

  /** Every frame: the picture on the sonar is drawn a frame at a time. */
  update(): void {
    const { w, units, devices } = this.c;
    const now = w.now;
    if (now >= this.refreshAt) this.refresh(now);
    // Headless runs of the Outpost have no contract system.
    const live = w.ctx.contracts?.sonar.live ?? 0;
    if (live <= 0) return;
    const fade = Math.min(1, live / SONAR.fade);
    const ghosts = this.ghosts;
    ghosts.length = 0;
    for (const d of devices.live) if (d.ghost) ghosts.push(d.ghost);
    // The tell: a false man flickers where a real one holds steady.
    if (ghosts.length > 0) w.ctx.render.highlight(ghosts, SONAR.enemyColor, fade * (0.55 + 0.45 * Math.abs(Math.sin(now * 7.3))));
    const ops = this.operators;
    ops.length = 0;
    for (const u of units.list) if ((u.kind === 'jammer' || u.kind === 'radio') && u.s.fighting) ops.push(u.s.e.char.mesh);
    if (ops.length > 0) w.ctx.render.highlight(ops, JAMMER_COLOR, fade);
  }

  private refresh(now: number): void {
    const { w, units, o } = this.c;
    this.refreshAt = now + REFRESH;
    this.hidden.clear();
    const jam = units.count('jammer') > 0;
    if (jam !== this.jammed) {
      this.jammed = jam;
      this.c.status('jammed', jam);
    }
    const p = w.player.position;
    for (const s of o.soldiers) {
      const u = unitOf(s);
      const d = s.e.position.distanceTo(p);
      const cold = u?.kind === 'hider' && u.step > 0 && d > HIDER_CLEAR;
      const scrambled = jam && d > JAM_CLEAR && u?.kind !== 'jammer' && u?.kind !== 'radio';
      if (cold || scrambled) this.hidden.add(s.e.char.mesh);
    }
    if (jam && now >= this.shuffleAt) {
      this.shuffleAt = now + rand(0.6, 1.2);
      for (const b of this.noise) {
        const a = rand(0, TAU);
        const r = rand(STATIC_RANGE[0], STATIC_RANGE[1]);
        b.position.set(p.x + Math.sin(a) * r, p.y, p.z + Math.cos(a) * r);
      }
    }
  }

  /**
   * What the minimap may show. It draws every body it is handed, so this hands it fewer, and some that do not exist. Called once a
   * frame by the HUD. The list is reused.
   */
  radar(real: readonly EnemyInstance[]): readonly EnemyInstance[] {
    const { w, devices } = this.c;
    const out = this.radarList;
    out.length = 0;
    const p = w.player.position;
    const pinged = w.ctx.contracts.sonar.live > 0;
    for (const e of real) {
      if (this.hidden.has(e.char.mesh) && !this.isOperator(e)) continue;
      const s = soldierOf(e);
      const u = s && unitOf(s);
      // A man on the floor looks like a man on the floor, until the ping says otherwise.
      if ((u?.kind === 'possum' || u?.kind === 'casualty') && !pinged) continue;
      if (u?.kind === 'hider' && u.step > 0 && e.position.distanceTo(p) > HIDER_CLEAR) continue;
      out.push(e);
    }
    if (this.jammed) for (const b of this.noise) out.push(b);
    if (pinged) {
      let i = 0;
      for (const d of devices.live) {
        if (!d.ghost) continue;
        const blip = this.beacons[i] ?? (this.beacons[i] = { uid: -100 - i, alive: true, isBoss: false, position: new THREE.Vector3() });
        blip.position.copy(d.ghost.position);
        out.push(blip);
        i++;
      }
    }
    return out as readonly EnemyInstance[];
  }

  private isOperator(e: EnemyInstance): boolean {
    const s = soldierOf(e);
    const u = s && unitOf(s);
    return u?.kind === 'jammer' || u?.kind === 'radio';
  }
}
