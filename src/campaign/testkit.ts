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
  racks: (() => void)[] = [];
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
  rack(_weapon: string, _at: unknown, took: () => void): void {
    this.racks.push(took);
  }
  drop(item: string): void {
    this.log.push(`drop ${item}`);
  }
  cutscene(_id: string, _scene: unknown, done: (skipped: boolean) => void): void {
    this.cutsceneDone = done;
  }
  ride(_seat: string, _route: unknown, done: () => void): void {
    this.rideDone = done;
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
  call(name: string): void {
    this.log.push(`call ${name}`);
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
