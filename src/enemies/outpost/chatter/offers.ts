/**
 * Tactics across squad borders (docs/design/squad-comms.md, "Cross-squad emergent tactics"). A unit advertises what it gives (an
 * offer); men nearby whose role fits claim it, whatever their squad; one man leads it, with a timeout; and every claim is said.
 *
 * Built so far: the riot shield's cover, the owner's shield wall.
 *
 *   1  in contact with the player close, the shield calls it: "Shield up, get behind me!"
 *   2  up to three riflemen or shotgunners within 12 m, any squad, claim it ("Moving with you!") and stack behind him; riflemen to
 *      his shoulders so they can fire past the edges, re-placed as he moves
 *   3  he walks at the player ("Pushing!")
 *   4  within 7 m of the player the shotgunners break out ("Now! Break!") and the squad brain takes them back
 *   5  a player who gets round the wall is called ("He's going around the shield!"); the shield already turns to face him
 *   6  the shield gone (arm, body or nerve): "Shield's down, scatter!", the followers are let go and lose some nerve
 *
 * The followers' squads keep thinking: a claimed man is re-placed every half second, so the wall holds while it lasts and dissolves
 * the moment the offer does.
 */
import * as THREE from 'three';
import type { Outpost } from '../index';
import { FEAR } from '../morale';
import type { Soldier } from '../soldier';

/** How close the player must be for the shield to offer, how far a claim reaches, and how many may stack. */
const OFFER_RANGE = 30;
const CLAIM_RANGE = 12;
const MAX_CLAIMS = 3;
/** The wall breaks up after this long, whatever happens. */
const OFFER_SECONDS = 20;
const BREAK_RANGE = 7;
/** Degrees off the shield's face that count as gone round it. */
const FLANKED = 75;
const STEP = 4;
const REPLACE = 0.5;

interface Offer {
  by: Soldier;
  until: number;
  claims: Soldier[];
  /** Everyone who has ever claimed this wall: a man who broke out does not come back to it. */
  had: Set<Soldier>;
  /** Next re-placing of the stack and the next step forward. */
  placeAt: number;
  flankedAt: number;
}

const _p = new THREE.Vector3();

export class Offers {
  readonly cover: Offer[] = [];
  /** Who already stands in a wall: nobody claims two. */
  private readonly taken = new Set<Soldier>();

  reset(): void {
    this.cover.length = 0;
    this.taken.clear();
  }

  tick(o: Outpost, now: number): void {
    const antiShield = o.w.player.airborne || o.w.player.heavyArmor;
    if (!antiShield) {
      for (const s of o.soldiers) {
        if (s.role !== 'shield' || !s.fighting || !s.e.shield || !s.squad.inContact || s.e.dist > OFFER_RANGE) continue;
        if (this.cover.some(c => c.by === s)) continue;
        this.cover.push({ by: s, until: now + OFFER_SECONDS, claims: [], had: new Set(), placeAt: 0, flankedAt: 0 });
        o.comms.say('shieldUp', s);
      }
    }
    for (let i = this.cover.length - 1; i >= 0; i--) {
      const c = this.cover[i]!;
      if (this.step(o, c, now)) continue;
      for (const m of c.claims) this.taken.delete(m);
      this.cover.splice(i, 1);
    }
  }

  /** False when the wall is over. */
  private step(o: Outpost, c: Offer, now: number): boolean {
    const s = c.by;
    const up = s.fighting && s.e.alive && s.e.shield && o.soldiers.includes(s);
    if (!up || now > c.until) {
      const voice = c.claims.find(m => m.fighting) ?? null;
      if (!up && voice) {
        o.comms.say('shieldDown', voice);
        for (const m of c.claims) if (m.fighting) o.scare(m, FEAR.allyDown * 0.5);
      }
      return false;
    }
    c.claims = c.claims.filter(m => m.fighting && o.soldiers.includes(m));
    // Claims: anyone near enough whose role fits, any squad.
    const dist = s.e.dist;
    for (const m of o.soldiers) {
      if (c.claims.length >= MAX_CLAIMS || dist < BREAK_RANGE) break;
      if (m === s || !m.fighting || this.taken.has(m) || c.had.has(m) || (m.role !== 'rifle' && m.role !== 'shotgun')) continue;
      if (m.e.position.distanceTo(s.e.position) > CLAIM_RANGE) continue;
      c.claims.push(m);
      c.had.add(m);
      this.taken.add(m);
      if (c.had.size === 1) o.comms.say('stackOn', m);
    }
    // Close enough: the shotguns go.
    if (dist < BREAK_RANGE) {
      const out = c.claims.filter(m => m.role === 'shotgun');
      if (out.length > 0) {
        o.comms.say('breakOut', out[0]!);
        for (const m of out) this.taken.delete(m);
        c.claims = c.claims.filter(m => m.role !== 'shotgun');
      }
    }
    // Gone round it.
    const p = o.w.player.position;
    const fx = Math.sin(s.e.yaw);
    const fz = Math.cos(s.e.yaw);
    const dx = p.x - s.e.position.x;
    const dz = p.z - s.e.position.z;
    const off = Math.acos(THREE.MathUtils.clamp((dx * fx + dz * fz) / (Math.hypot(dx, dz) || 1), -1, 1));
    if (off > (FLANKED * Math.PI) / 180 && now > c.flankedAt) {
      c.flankedAt = now + 6;
      o.comms.say('shieldFlanked', c.claims[0] ?? s);
    }
    if (now < c.placeAt) return true;
    c.placeAt = now + REPLACE;
    // He walks at the player; the stack keeps to his back and shoulders.
    if (dist > BREAK_RANGE + 1) {
      _p.set(dx, 0, dz).normalize().multiplyScalar(Math.min(STEP, dist - BREAK_RANGE)).add(s.e.position);
      if (o.w.ctx.world.nav.nearest(_p, 3, _p)) {
        if (!s.hasOrder) o.comms.say('shieldPush', s);
        o.order(s, _p, null, 1, 0);
      }
    }
    c.claims.forEach((m, i) => {
      const side = (i % 2 === 0 ? 1 : -1) * (m.role === 'rifle' ? 0.9 : 0.4);
      const back = 1.4 + Math.floor(i / 2) * 1.1;
      _p.set(s.e.position.x - fx * back - fz * side, s.e.position.y, s.e.position.z - fz * back + fx * side);
      if (m.e.position.distanceToSquared(_p) > 1 && o.w.ctx.world.nav.nearest(_p, 2, _p)) o.order(m, _p, null, 1, 0);
    });
    return true;
  }
}
