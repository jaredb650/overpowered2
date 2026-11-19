/**
 * The one answer to "is this browser a co-op guest in a running match": the world is the host's, and this game only draws it
 * and asks the host for what it wants done. False alone, on the host, and in a lobby walk (a session with no world yet).
 *
 * Six systems each had their own copy of this line; they all ask here now.
 */
import type { Ctx } from './contracts';

type Session = NonNullable<Ctx['coop']>;
/** A game whose co-op world is up, as the type checker should read it after `isGuest` says yes. */
type InMatch = { coop: Session & { world: NonNullable<Session['world']> } };

export function isGuest<T extends Pick<Ctx, 'coop'>>(ctx: T): ctx is T & InMatch {
  return !!ctx.coop?.world && !ctx.coop.hosting;
}
