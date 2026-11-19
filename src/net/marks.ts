/**
 * Pings (co-op): one key puts a marker in the world where the player is looking, in their colour with their name, for
 * `MARK_SECONDS`, on every screen. It shows on the minimap too (the minimap draws every world marker). With four players and no
 * voice it is the cheapest way to say "here".
 *
 * The pinger's own marker is instant. A guest's ping goes to the host, who stamps whose it is and passes it on; the host's
 * goes to every guest. Each player holds at most `MARK_KEEP` markers (a new one takes the oldest's place), and the host drops
 * pings that come faster than `MARK_GAP_MS` from one player.
 */
import * as THREE from 'three';
import { CG, type Ctx } from '../core/contracts';
import type { CoopSession } from './index';
import { COLORS } from './remote';
import type { WorldEvent } from './worldProtocol';
import type { Vec } from './world/wire';

export const MARK_SECONDS = 6;
export const MARK_KEEP = 2;
export const MARK_GAP_MS = 350;
/** Metres a ping reaches; past it, or into the sky, it lands this far along the look. */
const MARK_RANGE = 300;
const MARK_AIR = 40;
const MARK_DROP = 120;
const DOWN = new THREE.Vector3(0, -1, 0);

interface Mark { slot: number; until: number; at: THREE.Vector3; off: () => void }

export class Marks {
  /** The markers up now, oldest first. */
  readonly live: Mark[] = [];
  private readonly last = new Map<string, number>();
  private nextOwn = 0;
  private readonly at = new THREE.Vector3();

  constructor(private readonly ctx: Ctx, private readonly session: CoopSession, private readonly send: (event: WorldEvent, to?: string) => void) {}

  /** Host: may this player ping now? */
  allow(id: string, now: number): boolean {
    if (now - (this.last.get(id) ?? -Infinity) < MARK_GAP_MS) return false;
    this.last.set(id, now);
    return true;
  }

  /** The ping key, read every frame of a live run. */
  key(): void {
    const { input, player } = this.ctx;
    if (!input.pressed('ping') || !player.alive) return;
    const now = performance.now();
    if (now < this.nextOwn) return;
    this.nextOwn = now + MARK_GAP_MS;
    const hit = this.ctx.physics.raycast(player.eye, player.forward, MARK_RANGE, CG.World);
    if (hit) this.at.copy(hit.point);
    else {
      // Nothing in the way (the sky, an open yard): a point ahead, put down on whatever floor is under it.
      this.at.copy(player.eye).addScaledVector(player.forward, MARK_AIR);
      const floor = this.ctx.physics.raycast(this.at, DOWN, MARK_DROP, CG.World);
      if (floor) this.at.copy(floor.point);
    }
    const at = this.at.toArray() as Vec;
    const slot = this.session.lobby.me?.slot ?? 0;
    this.show(slot, at);
    this.send(this.session.hosting ? { t: 'mark', at, slot } : { t: 'mark', at });
  }

  /** A marker for `slot` at `at`, on this screen. */
  show(slot: number, at: Vec): void {
    const lobby = this.session.lobby;
    const player = lobby.players.find(p => p.slot === slot);
    if (!player) return;
    const mine = this.live.filter(m => m.slot === slot);
    if (mine.length >= MARK_KEEP) this.drop(mine[0]!);
    const color = `#${(COLORS[slot] ?? COLORS[0]!).toString(16).padStart(6, '0')}`;
    const position = new THREE.Vector3(...at);
    // Not the bare name: that is the tag over the player's own head.
    const off = this.ctx.hud.marker(position, player.id === lobby.you ? 'YOUR PING' : `PING · ${player.name}`, color);
    this.live.push({ slot, until: performance.now() + MARK_SECONDS * 1000, at: position, off });
    this.ctx.audio.play?.('ui_hover');
  }

  private drop(mark: Mark): void {
    const index = this.live.indexOf(mark);
    if (index >= 0) this.live.splice(index, 1);
    mark.off();
  }

  update(now: number): void {
    while (this.live.length && this.live[0]!.until <= now) this.drop(this.live[0]!);
  }

  dispose(): void {
    while (this.live.length) this.drop(this.live[0]!);
  }
}
