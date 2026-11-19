/** A pretend game for the runner: everything MissionHost asks for, written down instead of done. Tests only. */
import { EventBus } from '../core/events';
import type { GameEvents } from '../core/contracts';
import type { MissionHost, ObjectiveState } from './types';

export class FakeHost implements MissionHost {
  feet = { x: 0, y: 0, z: 0 };
  log: string[] = [];
  bus = new EventBus<GameEvents>();
  said: string[] = [];
  speaking: (() => void) | null = null;
  objectiveText: string[] = [];
  doorStates: Record<string, number> = {};
  doorDone: (() => void) | null = null;
  bodies = 1;
  deployed: { at: string | null; weapons: string } | null = null;
  finishedCount = 0;
  cutsceneDone: ((skipped: boolean) => void) | null = null;
  rideDone: (() => void) | null = null;
  sortieDone: (() => void) | null = null;
  frameDone: (() => void) | null = null;
  /** The player's squad, by type, and whether the sky is shut. */
  rosterMen: string[] = [];
  skyHeld = false;
  racks: (() => void)[] = [];
  /** The gun on each rack, beside `racks`. */
  rackGuns: string[] = [];
  /** Co-op (host.ts): the film's skip hook and its forced end, cues sent and played, guns issued, a ride in progress. */
  film = {
    askSkip: null as (() => boolean) | null,
    end: (skipped: boolean): void => {
      const done = this.cutsceneDone;
      this.cutsceneDone = null;
      if (!done) return;
      this.cue('filmEnd', skipped);
      done(skipped);
    },
  };
  shown: [name: string, args: readonly unknown[]][] = [];
  issuedGuns: string[] = [];
  riding = false;
  /** Each ride taken: `circle` over the fight first, or straight down its `route`. */
  rides: string[] = [];
  calls: [name: string, arg: string | undefined][] = [];
  autoSpeak = true;
  drills = true;
  ammo = Infinity;

  playerAt(out: { x: number; y: number; z: number }): void {
    Object.assign(out, this.feet);
  }
  listen(name: keyof GameEvents, fn: (payload: unknown) => void): () => void {
    return this.bus.on(name, fn);
  }
  speak(line: { id: string }, done: () => void): void {
    this.said.push(line.id);
    if (this.autoSpeak) done();
    else this.speaking = done;
  }
  hush(): void {
    this.speaking = null;
  }
  objectives(list: readonly ObjectiveState[]): void {
    this.objectiveText = list.filter(o => !o.done).map(o => o.text);
  }
  hint(text: string): void {
    this.log.push(`hint ${text}`);
  }
  banner(text: string): void {
    this.log.push(`banner ${text}`);
  }
  door(id: string, _def: unknown, open: number, seconds: number, done: () => void): void {
    this.doorStates[id] = open;
    if (seconds <= 0) done();
    else this.doorDone = done;
  }
  squad(order: { tag: string; men: readonly unknown[] }): void {
    this.log.push(`squad ${order.tag} ${order.men.length}`);
  }
  release(tag: string): void {
    this.log.push(`release ${tag}`);
  }
  sweep(tag?: string): void {
    this.log.push(tag ? `sweep ${tag}` : 'sweep');
  }
  drill(tag: string, drill: string): boolean {
    this.log.push(`drill ${tag} ${drill}`);
    return this.drills;
  }
  place(at: { at: readonly number[] }): void {
    this.log.push(`place ${at.at.join(',')}`);
  }
  vehicle(order: { tag: string }): void {
    this.log.push(`vehicle ${order.tag}`);
  }
  boss(tag: string): void {
    this.log.push(`boss ${tag}`);
  }
  health(): number {
    return this.bodies;
  }
  rounds(): number {
    return this.ammo;
  }
  give(weapon: string): void {
    this.log.push(`give ${weapon}`);
  }
  grenades(count: number): void {
    this.log.push(`grenades ${count}`);
  }
  rack(weapon: string, _at: unknown, took: () => void): void {
    this.racks.push(took);
    this.rackGuns.push(weapon);
  }
  cue(_name: string, ..._args: unknown[]): void {}
  show(name: string, args: readonly unknown[]): void {
    this.shown.push([name, args]);
    if (name === 'filmEnd') this.film.end(args[0] === true);
    if (name === 'alight') this.riding = false;
  }
  issue(weapon: string): void {
    this.issuedGuns.push(weapon);
    this.unrack(weapon);
  }
  taken(weapon: string): boolean {
    const took = this.unrack(weapon);
    took?.();
    return !!took;
  }
  private unrack(weapon: string): (() => void) | null {
    const i = this.rackGuns.indexOf(weapon);
    if (i < 0) return null;
    this.rackGuns.splice(i, 1);
    return this.racks.splice(i, 1)[0]!;
  }
  drop(item: string): void {
    this.log.push(`drop ${item}`);
  }
  cutscene(_id: string, _scene: unknown, done: (skipped: boolean) => void): void {
    this.cutsceneDone = done;
  }
  ride(_seat: string, _route: unknown, done: () => void, circle?: boolean): void {
    this.rideDone = done;
    this.riding = true;
    this.rides.push(circle ? 'circle' : 'route');
  }
  sortie(_over: unknown, done: () => void): void {
    this.sortieDone = done;
    this.riding = true;
  }
  frame(act: string, _at: unknown, done: () => void): void {
    this.log.push(`frame ${act}`);
    this.frameDone = done;
  }
  roster(men: readonly string[]): void {
    this.rosterMen = [...men];
  }
  callins(held: boolean): void {
    this.skyHeld = held;
  }
  battle(order: { id: string; bailiffs: readonly unknown[]; militia: readonly unknown[] }): void {
    this.log.push(`battle ${order.id} ${order.bailiffs.length}v${order.militia.length}`);
  }
  stop(battle: string): void {
    this.log.push(`stop ${battle}`);
  }
  adapt(): void {
    this.log.push('adapt');
  }
  field(answer: string): void {
    this.log.push(`field ${answer}`);
  }
  threat(level: number): void {
    this.log.push(`threat ${level}`);
  }
  music(state: string): void {
    this.log.push(`music ${state}`);
  }
  call(name: string, arg?: string): void {
    this.log.push(`call ${name}`);
    this.calls.push([name, arg]);
  }
  deploy(at: { at: readonly number[] } | null, loadout: { weapons: readonly string[] }): void {
    this.deployed = { at: at ? at.at.join(',') : null, weapons: loadout.weapons.join(',') };
  }
  saved(beat: { id: string }): void {
    this.log.push(`saved ${beat.id}`);
  }
  finished(): void {
    this.finishedCount++;
  }
}
