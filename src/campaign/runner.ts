/**
 * Plays a mission. It knows beats, triggers, scripts, objectives, the radio queue and checkpoints, and reaches the game only through
 * MissionHost, so a test can drive it with no game at all.
 *
 * A beat opens by saving its checkpoint, if it has one, and starting its script. Cues fire once each while it lasts, and `until`
 * moves on to the next row. Scripts stop with their beat. The radio does not, because a line in the air should finish.
 *
 * A death holds everything until `redeploy`. The game then rebuilds the run from nothing, as it does for any new run, and the runner
 * replays the saved beat from its top with the doors and objectives it was saved with. Restarting from a clean run is the point:
 * every system already knows how to clear itself, and nothing has to be undone by hand.
 */
import type { WeaponId } from '../core/gameplay';
import type { Line } from '../enemies/commander/lines';
import { arm, type Watch, type WatchFacts } from './watch';
import type { Beat, Cue, Mark, Mission, MissionHost, ObjectiveState, Script, Step, Zone } from './types';

export type RunnerState = 'idle' | 'running' | 'down' | 'won';

class Latch {
  open = false;
}

class ScriptRun {
  pc = 0;
  seconds = 0;
  latch: Latch | null = null;
  watch: Watch | null = null;
  constructor(readonly steps: Script) {}
}

interface LiveCue {
  watch: Watch;
  cue: Cue;
}

interface TagBook {
  spawned: number;
  left: number;
}

interface Save {
  index: number;
  doors: Map<string, number>;
  objectives: ObjectiveState[];
}

interface Spoken {
  line: Line;
  latch: Latch | null;
}

const HINT_SECONDS = 7;
const noop = (): void => {};

export class MissionRunner implements WatchFacts {
  state: RunnerState = 'idle';
  /** Seconds of mission time, across restarts. */
  elapsed = 0;
  deaths = 0;
  readonly feet = { x: 0, y: 0, z: 0 };

  private index = -1;
  private readonly scripts: ScriptRun[] = [];
  private readonly cues: LiveCue[] = [];
  private until: Watch | null = null;
  private readonly live = new Set<Watch>();
  private readonly tags = new Map<string, TagBook>();
  private readonly doors = new Map<string, number>();
  private objectiveList: ObjectiveState[] = [];
  private readonly heard = new Set<string>();
  /** Taken from racks, kept through every restart, so a gun found off the path is not lost to a checkpoint that never promised it. */
  private readonly taken = new Set<WeaponId>();
  private readonly lines = new Map<string, Line>();
  private readonly radio: Spoken[] = [];
  private speaking = false;
  /** Bumped by a hush, so a line that was cut off cannot finish anything. */
  private radioEpoch = 0;
  private save: Save | null = null;
  private redeploys = 0;
  /** Where to go once the frame's scripts have finished. A step cannot pull its own beat out from under the loop running it. */
  private pending: number | 'finish' | null = null;

  constructor(readonly mission: Mission, readonly host: MissionHost) {
    for (const line of mission.lines) this.lines.set(line.id, line);
  }

  get beat(): Beat | null {
    return this.mission.beats[this.index] ?? null;
  }

  get objectives(): readonly ObjectiveState[] {
    return this.objectiveList;
  }

  // ---------------------------------------------------------------------------------------------
  // What triggers read
  // ---------------------------------------------------------------------------------------------

  zone(id: string): Zone {
    const zone = this.mission.zones[id];
    if (!zone) throw new Error(`mission ${this.mission.id}: no zone ${id}`);
    return zone;
  }

  spawned(tag: string): number {
    return this.tags.get(tag)?.spawned ?? 0;
  }

  left(tag: string): number {
    return this.tags.get(tag)?.left ?? 0;
  }

  join(watch: Watch): void {
    this.live.add(watch);
  }

  leave(watch: Watch): void {
    this.live.delete(watch);
  }

  // ---------------------------------------------------------------------------------------------
  // Driving it
  // ---------------------------------------------------------------------------------------------

  /** From the top, or from a beat as if the mission had got there, which is how `?beat=` tests one fight. */
  start(beatId?: string): void {
    const { mission } = this;
    this.closeBeat();
    this.tags.clear();
    this.heard.clear();
    this.taken.clear();
    this.hush();
    this.objectiveList = [];
    this.elapsed = 0;
    this.deaths = 0;
    this.redeploys = 0;
    this.save = null;
    const index = beatId === undefined ? 0 : mission.beats.findIndex(b => b.id === beatId);
    if (index < 0) throw new Error(`mission ${mission.id}: no beat ${beatId}`);
    this.state = 'running';
    this.doors.clear();
    for (const id in mission.doors) this.setDoor(id, this.doorAt(id, index), 0, noop);
    this.host.objectives(this.objectiveList);
    this.deploy(index);
    this.pending = index;
    this.flush();
  }

  /** The player is dead. Everything waits for `redeploy`. */
  down(): void {
    if (this.state !== 'running') return;
    this.state = 'down';
    this.deaths++;
    this.hush();
  }

  /** The run has been rebuilt: back to the last checkpoint. */
  redeploy(): void {
    if (this.state !== 'down' || !this.save) return;
    const { save, mission } = this;
    this.closeBeat();
    this.tags.clear();
    this.state = 'running';
    this.doors.clear();
    for (const [id, open] of save.doors) this.setDoor(id, open, 0, noop);
    this.objectiveList = save.objectives.map(o => ({ ...o }));
    this.host.objectives(this.objectiveList);
    this.deploy(save.index);
    this.pending = save.index;
    this.flush();
    const lines = mission.redeployLines;
    if (lines.length > 0) this.say(lines[this.redeploys++ % lines.length]!, true, null);
  }

  update(dt: number): void {
    if (this.state !== 'running') return;
    this.elapsed += dt;
    this.host.playerAt(this.feet);
    for (let i = 0; i < this.scripts.length; i++) {
      const run = this.scripts[i]!;
      this.tick(run, dt);
      if (this.pending !== null) break;
    }
    if (this.pending === null) {
      for (let i = this.scripts.length - 1; i >= 0; i--) if (this.finished(this.scripts[i]!)) this.scripts.splice(i, 1);
      for (let i = 0; i < this.cues.length && this.pending === null;) {
        const cue = this.cues[i]!;
        if (!cue.watch.test(dt)) {
          i++;
          continue;
        }
        cue.watch.close();
        if (cue.cue.repeat) cue.watch = arm(cue.cue.when, this);
        else this.cues.splice(i, 1);
        this.begin(cue.cue.run);
        if (cue.cue.repeat) i++;
      }
    }
    if (this.pending === null && this.until?.test(dt)) this.pending = this.index + 1;
    this.flush();
  }

  /** A body under a tag has left the fight: `killed` is false for one who gave up or got away. */
  unitGone(tag: string, killed: boolean, source: string): void {
    const book = this.tags.get(tag);
    if (book && book.left > 0) book.left--;
    if (killed) this.noteKill(tag, source);
  }

  /** Any kill, tagged or not. `unitGone` calls this itself for tagged bodies. */
  noteKill(tag: string | null, source: string): void {
    for (const watch of this.live) watch.kill?.(tag, source);
  }

  signal(name: string): void {
    for (const watch of this.live) watch.signal?.(name);
  }

  /** One read of everything, for bots and the lab. */
  describe(): Record<string, unknown> {
    return {
      mission: this.mission.id,
      state: this.state,
      beat: this.beat?.id ?? null,
      elapsed: Math.round(this.elapsed),
      deaths: this.deaths,
      saved: this.save ? this.mission.beats[this.save.index]?.id : null,
      objectives: this.objectiveList.map(o => `${o.done ? '[x]' : '[ ]'} ${o.text}`),
      tags: Object.fromEntries([...this.tags].map(([tag, b]) => [tag, `${b.left}/${b.spawned}`])),
      doors: Object.fromEntries(this.doors),
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Beats
  // ---------------------------------------------------------------------------------------------

  private flush(): void {
    // A beat can leave as it opens, so this loops. Mission data with a cycle in it would hang here: `validateMission` rejects that.
    while (this.pending !== null) {
      const to = this.pending;
      this.pending = null;
      if (to === 'finish' || to >= this.mission.beats.length) {
        this.closeBeat();
        this.state = 'won';
        this.host.finished();
        return;
      }
      this.open(to);
    }
  }

  private closeBeat(): void {
    for (const run of this.scripts) run.watch?.close();
    this.scripts.length = 0;
    for (const cue of this.cues) cue.watch.close();
    this.cues.length = 0;
    this.until?.close();
    this.until = null;
  }

  private open(index: number): void {
    this.closeBeat();
    this.index = index;
    const beat = this.mission.beats[index]!;
    if (beat.checkpoint || !this.save) this.save = { index, doors: new Map(this.doors), objectives: this.objectiveList.map(o => ({ ...o })) };
    for (const cue of beat.cues ?? []) this.cues.push({ watch: arm(cue.when, this), cue });
    this.until = beat.until ? arm(beat.until, this) : null;
    if (beat.start) this.begin(beat.start);
  }

  /** The last checkpoint at or before this beat, or the mission's opening kit before the first one, plus anything found on the way. */
  private deploy(index: number): void {
    const { beats, marks, loadout } = this.mission;
    let at: Mark | null = null;
    let kit = loadout;
    for (let i = index; i >= 0; i--) {
      const c = beats[i]!.checkpoint;
      if (!c) continue;
      at = marks[c.at] ?? null;
      kit = c.loadout;
      break;
    }
    const weapons = [...kit.weapons];
    for (const w of this.taken) if (!weapons.includes(w)) weapons.push(w);
    this.host.deploy(at, { weapons, grenades: kit.grenades });
  }

  /** What a door would be doing by this beat, from every step that came before. */
  private doorAt(id: string, index: number): number {
    let open = this.mission.doors[id]!.start;
    const read = (steps: Script | undefined): void => {
      for (const s of steps ?? []) if (s.do === 'door' && s.door === id) open = s.open;
    };
    for (let i = 0; i < index; i++) {
      const beat = this.mission.beats[i]!;
      read(beat.start);
      for (const cue of beat.cues ?? []) read(cue.run);
    }
    return open;
  }

  // ---------------------------------------------------------------------------------------------
  // Scripts
  // ---------------------------------------------------------------------------------------------

  private begin(steps: Script): void {
    const run = new ScriptRun(steps);
    this.scripts.push(run);
    this.tick(run, 0);
  }

  private idle(run: ScriptRun): boolean {
    return run.seconds <= 0 && run.latch === null && run.watch === null;
  }

  private finished(run: ScriptRun): boolean {
    return run.pc >= run.steps.length && this.idle(run);
  }

  private tick(run: ScriptRun, dt: number): void {
    if (run.seconds > 0) {
      run.seconds -= dt;
      if (run.seconds > 0) return;
    }
    if (run.latch) {
      if (!run.latch.open) return;
      run.latch = null;
    }
    if (run.watch) {
      if (!run.watch.test(dt)) return;
      run.watch.close();
      run.watch = null;
    }
    while (run.pc < run.steps.length && this.idle(run) && this.pending === null) this.perform(run.steps[run.pc++]!, run);
  }

  private mark(id: string): Mark {
    const mark = this.mission.marks[id];
    if (!mark) throw new Error(`mission ${this.mission.id}: no mark ${id}`);
    return mark;
  }

  private route(id: string | undefined): Mark[] {
    if (id === undefined) return [];
    const route = this.mission.routes[id];
    if (!route) throw new Error(`mission ${this.mission.id}: no route ${id}`);
    return route.map(m => this.mark(m));
  }

  private book(tag: string, bodies: number): void {
    const book = this.tags.get(tag);
    if (book) {
      book.spawned += bodies;
      book.left += bodies;
    } else this.tags.set(tag, { spawned: bodies, left: bodies });
  }

  private hold(run: ScriptRun): Latch {
    return (run.latch = new Latch());
  }

  private perform(step: Step, run: ScriptRun): void {
    const { host } = this;
    switch (step.do) {
      case 'say':
        this.say(step.line, step.again === true, step.wait ? this.hold(run) : null);
        return;
      case 'objective':
        this.objectiveList = this.objectiveList.filter(o => o.id !== step.id);
        this.objectiveList.push({ id: step.id, text: step.text, at: step.at ? this.mark(step.at) : null, done: false });
        host.objectives(this.objectiveList);
        return;
      case 'done':
        for (const o of this.objectiveList) if (o.id === step.id) o.done = true;
        host.objectives(this.objectiveList);
        this.objectiveList = this.objectiveList.filter(o => !o.done);
        return;
      case 'hint':
        host.hint(step.text, step.seconds ?? HINT_SECONDS);
        return;
      case 'banner':
        host.banner(step.text, step.sub);
        return;
      case 'door': {
        const def = this.mission.doors[step.door];
        if (!def) throw new Error(`mission ${this.mission.id}: no door ${step.door}`);
        const was = this.doors.get(step.door) ?? def.start;
        const seconds = step.seconds ?? def.seconds * Math.abs(step.open - was);
        const latch = step.wait ? this.hold(run) : null;
        this.setDoor(step.door, step.open, seconds, () => {
          if (latch) latch.open = true;
        });
        return;
      }
      case 'squad':
        this.book(step.tag, step.men.length);
        host.squad(step, this.mark(step.at));
        return;
      case 'release':
        host.release(step.tag);
        return;
      case 'vehicle':
        this.book(step.tag, 1);
        if (step.crew && step.crew.length > 0) this.book(step.crewTag ?? step.tag, step.crew.length);
        host.vehicle(step, this.mark(step.at), this.route(step.route));
        return;
      case 'boss':
        this.book(step.tag, 1);
        host.boss(step.tag, this.mark(step.at));
        return;
      case 'give':
        host.give(step.weapon);
        return;
      case 'grenades':
        host.grenades(step.count);
        return;
      case 'rack': {
        const { weapon } = step;
        const took = (): void => {
          this.taken.add(weapon);
          this.signal(`took:${weapon}`);
        };
        if (this.taken.has(weapon)) took();
        else host.rack(weapon, this.mark(step.at), took);
        return;
      }
      case 'drop':
        host.drop(step.item, this.mark(step.at));
        return;
      case 'wait':
        run.seconds = step.seconds;
        return;
      case 'until':
        run.watch = arm(step.when, this);
        return;
      case 'signal':
        this.signal(step.name);
        return;
      case 'cutscene': {
        const scene = this.mission.cutscenes[step.id];
        if (!scene) throw new Error(`mission ${this.mission.id}: no cutscene ${step.id}`);
        const latch = this.hold(run);
        host.cutscene(step.id, scene, skipped => {
          if (skipped) this.hush();
          latch.open = true;
        });
        return;
      }
      case 'ride': {
        const latch = this.hold(run);
        host.ride(step.seat, this.route(step.route), () => {
          latch.open = true;
        });
        return;
      }
      case 'adapt':
        host.adapt();
        return;
      case 'field':
        host.field(step.answer);
        return;
      case 'threat':
        host.threat(step.level);
        return;
      case 'music':
        host.music(step.state);
        return;
      case 'call':
        host.call(step.name, step.arg);
        return;
      case 'goto': {
        const to = this.mission.beats.findIndex(b => b.id === step.beat);
        if (to < 0) throw new Error(`mission ${this.mission.id}: no beat ${step.beat}`);
        this.pending = to;
        return;
      }
      case 'finish':
        this.pending = 'finish';
        return;
    }
  }

  private setDoor(id: string, open: number, seconds: number, done: () => void): void {
    this.doors.set(id, open);
    this.host.door(id, this.mission.doors[id]!, open, seconds, done);
  }

  // ---------------------------------------------------------------------------------------------
  // Radio
  // ---------------------------------------------------------------------------------------------

  private say(id: string, again: boolean, latch: Latch | null): void {
    const line = this.lines.get(id);
    if (!line) throw new Error(`mission ${this.mission.id}: no line ${id}`);
    if (this.heard.has(id) && !again) {
      if (latch) latch.open = true;
      return;
    }
    this.heard.add(id);
    this.radio.push({ line, latch });
    this.nextLine();
  }

  private nextLine(): void {
    if (this.speaking) return;
    const next = this.radio.shift();
    if (!next) return;
    this.speaking = true;
    const epoch = this.radioEpoch;
    this.host.speak(next.line, () => {
      if (next.latch) next.latch.open = true;
      if (epoch !== this.radioEpoch) return;
      this.speaking = false;
      this.nextLine();
    });
  }

  private hush(): void {
    this.radioEpoch++;
    for (const spoken of this.radio) if (spoken.latch) spoken.latch.open = true;
    this.radio.length = 0;
    this.speaking = false;
    this.host.hush();
  }
}
