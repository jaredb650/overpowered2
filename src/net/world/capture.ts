/**
 * Prisoners for a guest (Endless Humans). The snapshot marks a surrendered man CAPTURABLE; a guest holds E on him and sends
 * `capture`; the host cuffs him as its own drone would, and when he is secured sends the bounty on to that guest as `credit`.
 */
import type * as THREE from 'three';
import type { Enemy } from '../../enemies/Enemy';
import { soldierOf } from '../../enemies/outpost/soldier';
import type { WorldContext, WorldModule } from './context';
import type { Replica, Replicas } from './replicas';
import { CAPTURABLE } from './snapshot';

export type CaptureEvent =
  /** Guest to host: I held E on this surrendered man. The host cuffs him for me; the bounty comes back as `credit`. */
  | { t: 'capture'; uid: number }
  /** Host to one guest: credits earned on the host's side for them (a prisoner's bounty). */
  | { t: 'credit'; amount: number; why: string };

/** A man who has given up and can still be cuffed. */
export function capturable(enemy: Enemy): boolean {
  const s = soldierOf(enemy);
  return !!s && s.surrendered && !s.released && !s.collared && !s.cuffed && s.fate === 'surrender';
}

export class Capture implements WorldModule {
  /** Host: who cuffed each prisoner (lobby id), so the bounty reaches them. */
  private readonly captors = new Map<number, string>();
  /** Guest: seconds E has been held on a surrendered man, and the prompt over him. */
  private held = -1;
  private prompt: { uid: number; off: () => void } | null = null;

  constructor(private readonly w: WorldContext, private readonly replicas: Replicas) {
    const { ctx, session } = w;
    if (w.hosting) {
      // A guest's prisoner: the host's purse was paid by the drone, so the bounty goes on to the guest who cuffed him.
      w.listen('prisoner:secured', e => {
        const captor = this.captors.get(e.enemy.uid);
        this.captors.delete(e.enemy.uid);
        if (!captor || captor === session.lobby.you || !(e.bounty > 0)) return;
        const wallet = ctx.contracts?.wallet as { credits?: number; earned?: number } | null | undefined;
        if (wallet && typeof wallet.credits === 'number') { wallet.credits -= e.bounty; if (typeof wallet.earned === 'number') wallet.earned -= e.bounty; }
        w.send({ t: 'credit', amount: e.bounty, why: 'PRISONER BOUNTY' }, captor);
      });
    }
    w.router.host('capture', (value, from, now) => {
      const remote = w.sender(from, now);
      if (remote) this.captureFor(from, remote.char.root.position, value.uid);
    });
    w.router.guest('credit', value => {
      const amount = Number.isFinite(value.amount) ? Math.max(0, Math.min(1e6, Math.round(value.amount))) : 0;
      const wallet = ctx.contracts?.wallet;
      if (amount && wallet) { wallet.earn(amount); ctx.hud.feed(`+${amount} CREDITS: ${String(value.why).slice(0, 24).toUpperCase()}`, '#ffc14a'); }
    });
  }

  /** Host: a guest held E on a surrendered man beside them. He is cuffed as if by the host, and the bounty is theirs. */
  private captureFor(from: string, at: THREE.Vector3, uid: unknown): void {
    const { ctx, session } = this.w;
    const enemy = ctx.enemies.alive.find(e => e.uid === uid) as Enemy | undefined;
    const soldier = enemy ? soldierOf(enemy) : null;
    if (!enemy || !soldier || !capturable(enemy) || enemy.position.distanceTo(at) > 4.5) return;
    // The drone's own cuff (airlift.ts), not the prisoners' key path, which would also drop whatever the host is holding.
    const airlift = (this.w.manager as unknown as { outpost?: { captives?: { airlift?: { cuff(s: unknown): void } } } }).outpost?.captives?.airlift;
    if (!airlift) return;
    this.captors.set(enemy.uid, from);
    airlift.cuff(soldier);
    const name = session.lobby.players.find(p => p.id === from)?.name ?? 'A teammate';
    ctx.hud.feed(`${name} cuffed a prisoner`, '#79f1ad');
  }

  /** Guest: hold E on a surrendered man in reach and in view, and the host cuffs him for you. */
  private key(dt: number): void {
    const { player, input, hud } = this.w.ctx;
    let best: Replica | null = null;
    let bestD = 3.1;
    if (player.alive && !player.parked) for (const replica of this.replicas.map.values()) {
      if (!(replica.to.flags & CAPTURABLE)) continue;
      const d = replica.enemy.position.distanceTo(player.position);
      if (d >= bestD) continue;
      const toward = replica.enemy.center.clone().sub(player.eye).normalize();
      if (toward.dot(player.forward) < 0.55) continue;
      best = replica; bestD = d;
    }
    const uid = best?.enemy.uid ?? -1;
    if (this.prompt && this.prompt.uid !== uid) { this.prompt.off(); this.prompt = null; }
    if (!best) { this.held = -1; return; }
    // The questions are the host's: a guest's E on a kneeling man is the capture alone, a 0.6 s hold with the ring.
    if (!this.prompt) this.prompt = { uid, off: hud.follow(best.enemy.center, `Hold [${input.labelFor?.('interact') ?? 'E'}] to capture`, '#ffc14a') };
    if (input.pressed('interact')) this.held = 0;
    if (this.held < 0) return;
    if (!input.isDown('interact')) { this.held = -1; return; }
    this.held += dt;
    hud.hold?.(Math.min(1, this.held / 0.6));
    if (this.held >= 0.6) { this.held = -1; this.w.send({ t: 'capture', uid }); }
  }

  update(): void {
    if (!this.w.hosting) this.key(this.w.ctx.time.realDt);
  }

  dispose(): void {
    this.prompt?.off();
  }
}
