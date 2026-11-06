/**
 * A trigger once it is armed. Clocks and counts start at that moment, so `{ kills: 3 }` means three more. `test` runs every frame the
 * trigger is live, and is the only part on the frame path: building one happens when a beat opens.
 */
import type { MissionHost, Trigger, Zone } from './types';

/** What a trigger can see of the mission. */
export interface WatchFacts {
  readonly host: MissionHost;
  zone(id: string): Zone;
  /** Bodies spawned under a tag so far, and those still to go. */
  spawned(tag: string): number;
  left(tag: string): number;
  /** Where the player's feet are this frame. */
  readonly feet: { x: number; y: number; z: number };
  /** Live watches hear about kills and signals through this. */
  join(watch: Watch): void;
  leave(watch: Watch): void;
}

export interface Watch {
  test(dt: number): boolean;
  kill?(tag: string | null, source: string): void;
  signal?(name: string): void;
  close(): void;
}

const inside = (z: Zone, p: { x: number; y: number; z: number }): boolean =>
  p.x >= z.min[0] && p.x <= z.max[0] && p.y >= z.min[1] && p.y <= z.max[1] && p.z >= z.min[2] && p.z <= z.max[2];

function clearedAll(facts: WatchFacts, tags: readonly string[]): boolean {
  for (const tag of tags) if (facts.spawned(tag) === 0 || facts.left(tag) > 0) return false;
  return true;
}

/** Fields compared one by one, so a mission can name a weapon or a flag without a line of code. */
function matches(payload: unknown, where: Readonly<Record<string, string | number | boolean>>): boolean {
  const fields = payload as Record<string, unknown>;
  for (const key in where) if (fields[key] !== where[key]) return false;
  return true;
}

const noop = (): void => {};

export function arm(trigger: Trigger, facts: WatchFacts): Watch {
  if ('zone' in trigger) {
    const zone = facts.zone(trigger.zone);
    const want = !trigger.outside;
    return { test: () => inside(zone, facts.feet) === want, close: noop };
  }
  if ('after' in trigger) {
    let left = trigger.after;
    return {
      test(dt) {
        left -= dt;
        return left <= 0;
      },
      close: noop,
    };
  }
  if ('kills' in trigger) {
    const { tag, by } = trigger;
    let count = 0;
    const watch: Watch = {
      test: () => count >= trigger.kills,
      kill(killed, source) {
        if ((tag === undefined || tag === killed) && (by === undefined || source.startsWith(by))) count++;
      },
      close: () => facts.leave(watch),
    };
    facts.join(watch);
    return watch;
  }
  if ('cleared' in trigger) {
    const tags = typeof trigger.cleared === 'string' ? [trigger.cleared] : trigger.cleared;
    return { test: () => clearedAll(facts, tags), close: noop };
  }
  if ('left' in trigger) {
    return { test: () => facts.spawned(trigger.tag) > 0 && facts.left(trigger.tag) <= trigger.left, close: noop };
  }
  if ('below' in trigger) {
    return { test: () => facts.spawned(trigger.tag) > 0 && facts.host.health(trigger.tag) <= trigger.below, close: noop };
  }
  if ('signal' in trigger) {
    let heard = false;
    const watch: Watch = {
      test: () => heard,
      signal(name) {
        if (name === trigger.signal) heard = true;
      },
      close: () => facts.leave(watch),
    };
    facts.join(watch);
    return watch;
  }
  if ('event' in trigger) {
    let seen = false;
    const off = facts.host.listen(trigger.event, payload => {
      if (!trigger.where || matches(payload, trigger.where)) seen = true;
    });
    return { test: () => seen, close: off };
  }
  // Every part is tested every frame, so a clock inside an `any` keeps running after a neighbour has come true.
  const parts = ('all' in trigger ? trigger.all : trigger.any).map(t => arm(t, facts));
  const need = 'all' in trigger ? parts.length : 1;
  return {
    test(dt) {
      let met = 0;
      for (const part of parts) if (part.test(dt)) met++;
      return met >= need;
    },
    close() {
      for (const part of parts) part.close();
    },
  };
}
