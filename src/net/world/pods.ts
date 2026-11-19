/**
 * The drop pods, shared: the supply pod each break brings (the shop is in it) and the weapon caches. The pods themselves and
 * every rule are progression/pickups/pods.ts; this carries their news. The host calls a pod and says where (`call`) and when it
 * goes (`gone`); a guest flies the same pod at the same spot, shops at it with its own purse, and tells the host when it has
 * had its share of a cache (`took`).
 */
import type { DropPods } from '../../progression/pickups/pods';
import type { WorldContext } from './context';
import type { Vec } from './wire';

/**
 * Host to guests: `call` (pod `id` is coming down at `at`, landing turned `yaw`, called `age` seconds ago) and `gone`.
 * Guest to host: `took` (I have had my share of cache `id`). `supply` says which of the two sets of pods it is about.
 */
export type PodEvent = { t: 'pod'; op: 'call' | 'gone' | 'took'; id: number; supply: boolean; at?: Vec; yaw?: number; age?: number };

export class Pods {
  constructor(private readonly w: WorldContext) {
    w.router.both('pod', (value, from) => this.podIn(value, from));
  }

  /** Progression keeps one set of pods a page: supply pods where the shop is on, weapon caches elsewhere. */
  private get pods(): DropPods | undefined {
    return (this.w.ctx.progression as unknown as { pods?: DropPods } | undefined)?.pods;
  }

  send(event: PodEvent, to?: string): void {
    console.info(`[coop pod] send ${event.op} #${event.id}${to ? ` to ${to}` : ''}`, event.at ?? '');
    this.w.send(event, to);
  }

  /** Guest: the share of a cache this player has had is said again (the host waits for every player's before the cache goes). */
  resay(): void {
    if (!this.w.hosting) this.pods?.resay?.();
  }

  /** Host: a guest's world is up: tell it the pods out now. */
  catchUp(id: string): void {
    this.pods?.catchUp(id);
  }

  private podIn(value: PodEvent, from: string): void {
    if (typeof value.op !== 'string' || typeof value.supply !== 'boolean') return;
    console.info(`[coop pod] got ${value.op} #${value.id} from ${from}`, value.at ?? '');
    this.pods?.netIn(value, from);
  }
}
