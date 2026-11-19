/**
 * Where an arriving world event goes. Each feature module (and team.ts, mission.ts) registers the event types it handles, for the
 * side that hears them: `host` (a guest sent it), `guest` (the host sent it) or `both`. One handler per type and side: a second
 * registration is a mistake and throws when the world is built.
 *
 * To add an event: declare its shape in your module's own file, add that type to the `WorldEvent` union (worldProtocol.ts, one
 * line), and register a handler in your module's constructor. Send it with `WorldContext.send` (context.ts).
 */
import type { WorldEvent } from '../worldProtocol';

export type EventType = WorldEvent['t'];
export type EventOf<T extends EventType> = Extract<WorldEvent, { t: T }>;
/** `from` is the sender's lobby id; `now` is `performance.now()`, read once as the event arrived. */
export type Handler<T extends EventType> = (event: EventOf<T>, from: string, now: number) => void;
type AnyHandler = (event: WorldEvent, from: string, now: number) => void;

export class Router {
  private readonly hostSide = new Map<string, AnyHandler>();
  private readonly guestSide = new Map<string, AnyHandler>();

  /** The host hears this from a guest. */
  host<T extends EventType>(type: T, handler: Handler<T>): void { this.add(this.hostSide, 'host', type, handler as AnyHandler); }
  /** A guest hears this from the host. */
  guest<T extends EventType>(type: T, handler: Handler<T>): void { this.add(this.guestSide, 'guest', type, handler as AnyHandler); }
  /** Heard on either side: the handler tells them apart itself. */
  both<T extends EventType>(type: T, handler: Handler<T>): void { this.host(type, handler); this.guest(type, handler); }

  private add(side: Map<string, AnyHandler>, name: string, type: string, handler: AnyHandler): void {
    if (side.has(type)) throw new Error(`[coop] Two handlers for the ${name}'s '${type}' event`);
    side.set(type, handler);
  }

  /** Runs the handler for this event on this side. An event nobody registered for is dropped. */
  dispatch(event: WorldEvent, from: string, hosting: boolean, now: number): void {
    (hosting ? this.hostSide : this.guestSide).get(event.t)?.(event, from, now);
  }
}
