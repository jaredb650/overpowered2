/**
 * The wave director of Outpost Defense (docs/proposals/outpost-defense.md, piece 7): `ctx.waves` on the defense contract when it plays
 * on the fort. `waves.ts` says who comes; this brings them, a squad at a time from the fence, trucks and tanks up the lanes,
 * helicopters from the sky spawns and the undead bosses dropped on the field, and hands every man to `siege.ts`. A wave clears when
 * nobody is left fighting and no machine is left running. Breaks are the economy's; this only says how long and what is coming.
 *
 * The Commander still lives under the Outpost but is never asked to compose a wave or brief a break, so he never comes down in person
 * and his death cannot end an endless run (commander/person.ts refuses this contract as well).
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import type { EnemyId, WavePhase } from '../../core/gameplay';
import { rand } from '../../core/math';
import type { Enemy } from '../../enemies/Enemy';
import type { EnemyManager } from '../../enemies/EnemyManager';
import type { Outpost } from '../../enemies/outpost';
import { soldierOf } from '../../enemies/outpost/soldier';
import { FORT_LANES, FORT_SPAWNS, ring } from '../../world/map/fort/plan';
import type { DefenseWaves } from './index';
import { Siege, type JobKind, type Team } from './siege';
import { bossLine, breakBefore, DIRECTOR, menIn, planWave, previewLine, type WavePlan } from './waves';

const TICK_SECONDS = 3;
const MAN_GAP = 0.55;
const SQUAD_GAP = 2.5;
const VEHICLE_GAP = 7;
const BOSS_GAP = 14;
const BOMBER_GAP = 9;
/** A truck's load, by wave. */
const TRUCK_CREW: readonly EnemyId[] = ['trooper', 'gunner', 'trooper', 'rocketeer', 'trooper'];
const HUMVEE_CREW: readonly EnemyId[] = ['trooper', 'gunner'];
/** Where the enemy helicopter swings round: four corners off the outer wall. */
const CHOPPER_MARKS = [[-40, -40], [40, -40], [40, 40], [-40, 40]] as const;

type Machine = 'truck' | 'humvee' | 'tank';

interface Arrival {
  ids: EnemyId[];
  jobs: JobKind[];
  side: number;
  /** The spot by the fence the squad comes in at, chosen as its first man does. */
  readonly at: THREE.Vector3;
  team: Team | null | undefined;
}

const _a = new THREE.Vector3();

export class DefenseDirector implements DefenseWaves {
  wave = 0;
  phase: WavePhase = 'intermission';
  nextWaveIn = 0;
  plan: WavePlan | null = null;
  readonly siege: Siege;

  private running = false;
  private queue: Arrival[] = [];
  private cursor = 0;
  private seat = 0;
  private clock = 0;
  private lastTick = 0;
  private machines: Machine[] = [];
  private machineClock = 0;
  private choppers = 0;
  private chopperClock = 0;
  private bosses: EnemyId[] = [];
  private bossClock = 0;
  private bombers = 0;
  private bomberClock = 0;
  private sides: number[] = [0];
  private serial = 0;
  private tagged = 0;

  constructor(private readonly ctx: Ctx, private readonly o: Outpost, private readonly manager: EnemyManager) {
    this.siege = new Siege(ctx, o, manager);
  }

  reset(): void {
    this.wave = 0;
    this.phase = 'intermission';
    this.nextWaveIn = 0;
    this.plan = null;
    this.queue = [];
    this.cursor = this.seat = 0;
    this.machines = [];
    this.bosses = [];
    this.choppers = this.bombers = 0;
    this.running = false;
    this.manager.queued = 0;
    this.siege.reset();
  }

  start(): void {
    this.reset();
    this.running = true;
    this.nextWaveIn = DIRECTOR.firstBreak;
    this.ctx.audio.music('easy');
  }

  /** For the lab and bots: straight to a wave. */
  jumpTo(wave: number): void {
    this.running = true;
    this.wave = wave - 1;
    this.nextWaveIn = 0;
    this.phase = 'intermission';
  }

  preview(wave: number): string {
    return previewLine(this.planFor(wave));
  }

  breakSeconds(wave: number): number {
    return breakBefore(wave);
  }

  /** The plan for `wave`, rolled once and kept, so the break's preview is the wave that comes. */
  private planFor(wave: number): WavePlan {
    if (this.plan?.wave !== wave) this.plan = planWave(wave);
    return this.plan;
  }

  update(): void {
    if (!this.running) return;
    const dt = this.ctx.time.dt;
    this.siege.update();
    if (this.phase === 'intermission') {
      this.nextWaveIn -= dt;
      const whole = Math.ceil(this.nextWaveIn);
      if (whole !== this.lastTick) {
        this.lastTick = whole;
        if (whole > 0 && whole <= TICK_SECONDS && this.wave > 0) this.ctx.audio.play('wave_tick');
      }
      if (this.nextWaveIn <= 0) this.begin(this.wave + 1);
      return;
    }
    this.feed(dt);
    this.feedMachines(dt);
    this.feedBosses(dt);
    if (this.phase === 'spawning' && this.cursor >= this.queue.length && !this.machines.length && !this.bosses.length && !this.choppers && !this.bombers) {
      this.phase = 'clearing';
    }
    this.checkClear();
  }

  // -------------------------------------------------------------------------------------------
  // A wave
  // -------------------------------------------------------------------------------------------

  private begin(wave: number): void {
    const { ctx, manager } = this;
    const plan = this.planFor(wave);
    this.wave = wave;
    manager.setWave(wave);
    // The fronts it comes from: one or two sides early, every side late.
    const fronts = wave < 4 ? 2 : wave < 10 ? 3 : 4;
    const first = Math.floor(rand(0, 4));
    this.sides = Array.from({ length: fronts }, (_, i) => (first + i) & 3);
    const regular = plan.squads.length - plan.mortars - plan.engineers;
    let sappers = plan.sappers;
    this.queue = plan.squads.map((ids, i) => {
      const jobs: JobKind[] = ids.map((id, seat) => {
        if (i >= regular + plan.mortars) return 'engineer';
        if (i >= regular) return 'crew';
        if (id === 'trooper' && seat < 2 && sappers > 0) {
          sappers--;
          return 'sapper';
        }
        return 'assault';
      });
      return { ids: [...ids], jobs, side: this.sides[i % this.sides.length]!, at: new THREE.Vector3(), team: undefined };
    });
    this.cursor = this.seat = 0;
    this.clock = 0.4;
    this.machines = [
      ...Array<Machine>(plan.tanks).fill('tank'),
      ...Array<Machine>(plan.trucks).fill('truck'),
      ...Array<Machine>(plan.humvees).fill('humvee'),
    ];
    this.machineClock = 6;
    this.choppers = plan.choppers;
    this.chopperClock = 4;
    this.bosses = [...Array<EnemyId>(plan.juggernauts).fill('juggernaut'), ...Array<EnemyId>(plan.titans).fill('titan')];
    this.bossClock = 10;
    this.bombers = plan.bombers;
    this.bomberClock = 25;
    manager.queued = menIn(plan) + plan.bombers + this.bosses.length;
    this.phase = 'spawning';
    if (wave >= 10) ctx.audio.music('hard');
    ctx.audio.play(wave >= 10 || plan.boss ? 'wave_start_hard' : 'wave_start');
    ctx.events.emit('wave:start', { wave, total: manager.queued + this.machines.length + this.choppers, boss: plan.boss !== null });
    if (plan.boss) {
      ctx.audio.play('boss_alarm');
      ctx.hud.banner(bossLine(plan), `WAVE ${wave}`, '#ff5a3a');
    }
  }

  /** Squads from the fence, a man at a time, while there is room in the fight. */
  private feed(dt: number): void {
    if (this.cursor >= this.queue.length) return;
    this.clock -= dt;
    if (this.clock > 0) return;
    const arrival = this.queue[this.cursor]!;
    if (this.seat === 0) {
      if (this.o.hostile + arrival.ids.length > DIRECTOR.aliveCap) return;
      this.spawnAt(arrival.side, arrival.at);
      this.o.formSquad(arrival.ids.length, arrival.at.clone());
      this.o.squads[this.o.squads.length - 1]!.directed = true;
    }
    const crew = arrival.jobs[this.seat] === 'crew';
    // A mortar crew's pit is claimed as its first man comes through the fence.
    if (crew && arrival.team === undefined) arrival.team = this.siege.newTeam(arrival.at);
    const team = crew ? arrival.team ?? null : null;
    const e = this.manager.spawn(arrival.ids[this.seat]!, arrival.at);
    const s = e ? soldierOf(e) : undefined;
    if (s) this.siege.assign(s, team || arrival.jobs[this.seat] !== 'crew' ? arrival.jobs[this.seat]! : 'assault', team);
    if (e) this.manager.queued = Math.max(0, this.manager.queued - 1);
    this.seat++;
    if (this.seat < arrival.ids.length) {
      this.clock = MAN_GAP;
      return;
    }
    this.seat = 0;
    this.cursor++;
    this.clock = SQUAD_GAP;
  }

  /** A foot spawn on one of the wave's sides, at random along it. */
  private spawnAt(side: number, out: THREE.Vector3): THREE.Vector3 {
    const list = FORT_SPAWNS.foot.slice(side * 4, side * 4 + 4);
    const p = list[Math.floor(rand(0, list.length))]!.pos;
    out.set(p[0] + rand(-2, 2), p[1], p[2] + rand(-2, 2));
    this.ctx.world.nav.nearest(out, 6, out);
    return out;
  }

  /** Trucks and tanks up the lanes of the wave's sides, the next once the last is clear of the entry. */
  private feedMachines(dt: number): void {
    const v = this.manager.vehicles;
    if (!v) {
      this.machines.length = 0;
      this.choppers = 0;
      return;
    }
    this.machineClock -= dt;
    if (this.machines.length && this.machineClock <= 0) {
      this.machineClock = VEHICLE_GAP;
      const kind = this.machines.shift()!;
      // Road lanes first: north, east, south, west; the corner lanes for the second machine on a side.
      const side = this.sides[this.serial % this.sides.length]!;
      const lane = FORT_LANES[side + (Math.floor(this.serial / this.sides.length) % 2) * 4]!;
      this.serial++;
      const [sx, sz] = lane.points[0]!;
      const [ex, ez] = lane.points[1]!;
      const tag = kind === 'tank' ? `tank-${++this.tagged}` : null;
      v.spawnGround(kind, {
        x: sx, y: 0, z: sz, route: [{ x: ex, z: ez, hold: 0 }], tag,
        crew: kind === 'truck' ? TRUCK_CREW : kind === 'humvee' ? HUMVEE_CREW : [], crewTag: null, holds: false, holdYaw: Number.NaN, parked: false,
      });
      if (tag) v.target(tag);
    }
    this.chopperClock -= dt;
    if (this.choppers > 0 && this.chopperClock <= 0 && !v.chopperAt(_a)) {
      this.chopperClock = BOSS_GAP;
      this.choppers--;
      const from = FORT_SPAWNS.air[Math.floor(rand(0, FORT_SPAWNS.air.length))]!;
      const marks = CHOPPER_MARKS.map(([x, z]) => new THREE.Vector3(x, 0, z));
      const tag = `chopper-${++this.tagged}`;
      v.spawnChopper(new THREE.Vector3(...from), marks, tag);
      v.target(tag);
      this.ctx.audio.play('boss_alarm');
    }
  }

  /** The Juggernaut and the Titan drop out of the sky onto the field, where the player can watch them come. Bombers walk in. */
  private feedBosses(dt: number): void {
    this.bossClock -= dt;
    if (this.bosses.length && this.bossClock <= 0) {
      this.bossClock = BOSS_GAP;
      const id = this.bosses.shift()!;
      const lane = FORT_LANES[this.sides[this.serial++ % this.sides.length]!]!;
      // Halfway up the lane: in the open, clear of the fence and of the walls.
      const [sx, sz] = lane.points[0]!;
      const [ex, ez] = lane.points[1]!;
      _a.set((sx + ex) / 2, 0, (sz + ez) / 2);
      this.ctx.world.nav.nearest(_a, 8, _a);
      const e = this.manager.spawn(id, _a);
      if (e) {
        this.drop(e, id);
        this.manager.queued = Math.max(0, this.manager.queued - 1);
      } else this.bosses.unshift(id);
    }
    this.bomberClock -= dt;
    if (this.bombers > 0 && this.bomberClock <= 0 && this.o.hostile < DIRECTOR.aliveCap + 4) {
      this.bomberClock = BOMBER_GAP;
      this.bombers--;
      const e = this.manager.spawn('bomber', this.spawnAt(this.sides[this.bombers % this.sides.length]!, _a));
      if (e) {
        this.siege.besiege(e);
        this.manager.queued = Math.max(0, this.manager.queued - 1);
      }
    }
  }

  /** The swarm's boss entrance (EnemyManager.spawnBoss) on a point of our choosing. */
  private drop(e: Enemy, id: EnemyId): void {
    e.entrance = 'boss';
    e.airborne = true;
    e.position.y += 42;
    e.verticalSpeed = -46;
    this.o.w.telegraphs.zone(_a, id === 'titan' ? 16 : 9, 0.9, 0xff5a1e);
    this.ctx.audio.play('boss_alarm');
    this.siege.besiege(e);
  }

  private checkClear(): void {
    const { ctx, manager } = this;
    if (this.phase !== 'clearing' || manager.queued > 0 || this.o.hostile > 0 || manager.bossDying) return;
    const v = manager.vehicles;
    if (v && v.live.some(x => x.alive && !x.retired)) return;
    const bonus = 500 + 150 * this.wave;
    ctx.audio.play('wave_clear');
    ctx.events.emit('wave:clear', { wave: this.wave, bonus });
    this.phase = 'intermission';
    this.nextWaveIn = breakBefore(this.wave + 1);
  }

  describe(): Record<string, unknown> {
    return {
      wave: this.wave, phase: this.phase, next: Math.round(this.nextWaveIn), queued: this.manager.queued, hostile: this.o.hostile,
      squadsLeft: this.queue.length - this.cursor, machines: this.machines.length, choppers: this.choppers, bosses: this.bosses.length,
      bombers: this.bombers, vehicles: this.manager.vehicles?.live.filter(x => x.alive && !x.retired).map(x => x.def.kind) ?? [],
      siege: this.siege.describe(), outer: ring('outer').half,
    };
  }
}
