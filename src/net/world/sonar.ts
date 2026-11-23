/**
 * The Sonar brain chip is shared: a player's ping goes out as `sonar` (the host passes a guest's on), and every other player runs
 * the same ring and reveal from that point, with a feed line. Thermal and Focus are each player's own and never sent.
 */
import * as THREE from 'three';
import type { WorldContext, WorldModule } from './context';
import { validVec, type Vec } from './wire';

/** Someone's Sonar went out from `at`: everyone sees what it lights, with a feed line. */
export type SonarEvent = { t: 'sonar'; at: Vec; slot?: number };

/** Minimum milliseconds between relayed sonar pings from one guest (the chip itself has a much longer cooldown). */
const SONAR_COOLDOWN_MS = 1000;

export class SharedSonar implements WorldModule {
  private readonly last = new Map<string, number>();

  constructor(private readonly w: WorldContext) {
    const { ctx, session } = w;
    w.listen('sonar:ping', event => w.send({ t: 'sonar', at: event.origin.toArray() as Vec, slot: session.lobby.me?.slot }));
    w.router.both('sonar', (value, from, now) => {
      const player = w.playerOf(from, value.slot);
      if (!player || player.id === session.lobby.you || !validVec(value.at)) return;
      if (session.hosting) {
        const prev = this.last.get(from) ?? -Infinity;
        if (now - prev < SONAR_COOLDOWN_MS) return;
        this.last.set(from, now);
      }
      ctx.hud.feed(`${player.name} used sonar`, '#39e0ff');
      ctx.contracts?.sonar.share?.(new THREE.Vector3(...value.at));
      if (session.hosting) w.relay({ ...value, slot: player.slot }, from);
    });
  }

  forgetPeer(id: string): void { this.last.delete(id); }
}

/** For a peer that is behind: which of this module's events may be left out (net/pressure.ts). A fact never is. */
export const SONAR_WIRE: import('../pressure').WireClasses<SonarEvent> = { sonar: 'fact' };
