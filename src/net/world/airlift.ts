/**
 * The capture skyhook on every screen. Prisoners and their capture live on the host (enemies/outpost/airlift.ts): when it
 * sends a drone for a cuffed man it says so, and every guest flies the same drone on the same pass, with its hook and line,
 * and lifts its own copy of the man off the floor as the hook reaches him (`AirliftCopy`). Without this a guest saw the cuffed
 * man simply vanish.
 *
 *   airlift   host to guests: `uid`, where the hook takes him (`at`), the heading of the pass (`dir`, on the ground), and the
 *             seconds until it does (`in`). With no `at`: he came off the line, or left the round, and the pass is off
 */
import * as THREE from 'three';
import { AirliftCopy, type Airlift } from '../../enemies/outpost/airlift';
import type { WorldContext, WorldModule } from './context';
import { validVec, type Vec } from './wire';

export type AirliftEvent = { t: 'airlift'; uid: number; at?: Vec; dir?: [number, number]; in?: number };

const mm = (value: number): number => Math.round(value * 1000) / 1000;

export class Skyhook implements WorldModule {
  /** Guest: the drones flown here. Built on the first pass. */
  private copy: AirliftCopy | null = null;
  private plugged = false;
  private readonly at = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  /** Host: the passes on their way to a man now, for a player who arrives before the hook does. */
  private readonly passes = new Map<number, { at: Vec; dir: [number, number]; until: number }>();

  constructor(private readonly w: WorldContext) {
    w.router.guest('airlift', value => this.passIn(value));
    w.listen('run:start', () => this.copy?.clear());
  }

  /** For the proofs: the drones in the air on this screen, and where. */
  get flying(): number { return this.copy?.flying ?? 0; }
  get drones(): THREE.Vector3[] { return this.copy?.positions ?? []; }

  /** Host: the outpost is built after the world, so the line to its airlift is made the first frame it is there. */
  private plug(): void {
    if (this.plugged || !this.w.hosting) return;
    const airlift = (this.w.manager as unknown as { outpost?: { captives?: { airlift?: Airlift } } }).outpost?.captives?.airlift;
    if (!airlift) return;
    this.plugged = true;
    airlift.onPass = (uid, at, dir, lead) => {
      if (!this.w.ready) return;
      if (at) this.passes.set(uid, { at: [mm(at.x), mm(at.y), mm(at.z)], dir: [mm(dir.x), mm(dir.z)], until: performance.now() + lead * 1000 });
      else this.passes.delete(uid);
      this.w.send(at ? { t: 'airlift', uid, at: [mm(at.x), mm(at.y), mm(at.z)], dir: [mm(dir.x), mm(dir.z)], in: mm(lead) } : { t: 'airlift', uid });
    };
  }

  /** Host: a player's world is up. A drone still on its way to a man is flown on their screen too, with the seconds it has left. */
  catchUp(id: string): void {
    if (!this.w.hosting) return;
    const now = performance.now();
    for (const [uid, pass] of this.passes) {
      const left = (pass.until - now) / 1000;
      if (left <= 0.2) { this.passes.delete(uid); continue; }
      this.w.send({ t: 'airlift', uid, at: pass.at, dir: pass.dir, in: mm(left) }, id);
    }
  }

  private passIn(value: AirliftEvent): void {
    if (!Number.isInteger(value.uid) || value.uid < 0) return;
    if (value.at === undefined) {
      this.copy?.cancel(value.uid);
      return;
    }
    const dir = value.dir;
    if (!validVec(value.at) || !Array.isArray(dir) || dir.length !== 2 || !dir.every(Number.isFinite) || !Number.isFinite(value.in) || value.in! < 0 || value.in! > 60) return;
    if (Math.hypot(dir[0], dir[1]) < 0.5) return;
    this.copy ??= new AirliftCopy(this.w.ctx);
    this.copy.begin(value.uid, this.at.set(...value.at), this.dir.set(dir[0], 0, dir[1]), value.in!);
  }

  update(): void {
    this.plug();
    this.copy?.update(this.w.ctx.time.dt);
  }

  dispose(): void {
    this.copy?.clear();
    if (!this.plugged) return;
    const airlift = (this.w.manager as unknown as { outpost?: { captives?: { airlift?: Airlift } } }).outpost?.captives?.airlift;
    if (airlift) airlift.onPass = null;
  }
}
