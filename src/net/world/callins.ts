/**
 * Call-ins across players. Today only the news: a player's `callin:used` goes out as `callin`, the others get a feed line, and
 * the host notes it so the caller's call-in damage passes the claim checks (authority.ts `callIn`). The aircraft and their
 * effects are drawn on the caller's screen only.
 */
import type { WorldContext } from './context';

/** Someone called a strike or an aircraft in: a feed line for the others. */
export type CallinEvent = { t: 'callin'; id: string; slot?: number };

export class Callins {
  constructor(private readonly w: WorldContext) {
    const { ctx, session } = w;
    w.listen('callin:used', event => w.send({ t: 'callin', id: event.id, slot: session.lobby.me?.slot }));
    w.router.both('callin', (value, from, now) => {
      const player = w.playerOf(from, value.slot);
      const name = typeof value.id === 'string' ? value.id.replace(/[^a-zA-Z]/g, '').replace(/([A-Z])/g, ' $1').toUpperCase().slice(0, 24) : '';
      if (player && name) ctx.hud.feed(`${player.name} called in ${name}`, '#ffc14a');
      if (session.hosting && player) {
        w.validator.callIn(from, now);
        w.relay({ ...value, slot: player.slot }, from);
      }
    });
  }
}
