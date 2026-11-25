/**
 * Crossfire Part 1 — "Valken Airbase" (`map: 'airbase'`, Contractor #7712-A, ~8–9 min).
 *
 * You raid Northern Command's Valken Airbase on foot beside your 4-man buddy squad (Viper Squad),
 * Viper-2/3 wingmen, and combined-arms Bureau armor (2 Jackal technicals + 1 Aegis MBT):
 *   1. perimeter — Satchel-breach South Radar Gate & smash Darrow's courtyard garrison + guntruck
 *   2. apron     — Pinned at the locked Inner Blast Gate by Northern armor & endless Hangar 02 defenders;
 *                  detonate the marked JP-8 Fuel Depots to chain-blast the red pipeline and blow the gate open!
 *   3. tower     — Fight up all 4 levels of the 3-Level ATC Tower (y = 0 -> 10.8) & hit the Hangar Override / IFF Spoof Console
 *   4. hangar    — Storm the Hardened Alert Hangar, crush Darrow's armored QRF push (tank + QRF truck) as Viper-2/3 board the 2 F-22 Raptors
 *   5. takeoff   — Climb into the 28.2 m B-1B Lancer yourself, taxi onto Runway 01/19, ignite afterburners, and climb through the takeoff gate -> Strait handoff
 */
import type { AllyType } from '../../allies/data';
import {
  AIRBASE_ALERT_HANGAR,
  AIRBASE_ATC_CONSOLE,
  AIRBASE_ATC_TOWER,
  AIRBASE_BUDDY_RAPTOR_SPAWNS,
  AIRBASE_DESTRUCTIBLES,
  AIRBASE_ENEMY_SPAWNS,
  AIRBASE_INNER_GATE,
  AIRBASE_LANCER_SPAWN,
  AIRBASE_PICKUPS,
  AIRBASE_PLAYER_SPAWN,
  AIRBASE_PLAYER_YAW,
  AIRBASE_RUNWAY,
  AIRBASE_SOUTH_GATE,
  AIRBASE_TAKEOFF_GATE,
  AIRBASE_VEHICLE_ROUTES,
  AIRBASE_ZONES,
} from '../../world/map/airbase/plan';
import { CROSSFIRE_SIGNALS } from '../crossfire/chain';
import type { Cutscene, DoorDef, Loadout, Mark, Mission, Step, Zone } from '../types';
import { CROSSFIRE_AIRBASE_LINES, CROSSFIRE_AIRBASE_REDEPLOY } from './crossfire.lines';

const say = (key: string, opts: { wait?: boolean; now?: boolean; again?: boolean; within?: number } = {}): Step => ({
  do: 'say',
  line: `mission.crossfire.airbase.${key}`,
  ...opts,
});

/** Contractor A assault loadout (slots 1, 2, 3, 6, 5). */
const RAID_LOADOUT: Loadout = {
  weapons: ['harrow', 'shotgun', 'satchel', 'ultramag', 'knife'],
  grenades: 4,
};

/** 4 friendly Bailiff/contractor wingmen fighting beside you from the south perimeter to the Alert Hangar. */
const VIPER_SQUAD: readonly AllyType[] = ['rifleman', 'gunner', 'rocketeer', 'medic'];

function zoneFromPlan(id: (typeof AIRBASE_ZONES)[number]['id']): Zone {
  const z = AIRBASE_ZONES.find(item => item.id === id)!;
  return { min: [z.x0, z.y0, z.z0], max: [z.x1, z.y1, z.z1] };
}

function routeFromPlan(id: string): readonly (readonly [number, number])[] {
  const r = AIRBASE_VEHICLE_ROUTES.find(v => v.id === id)!;
  return [r.spawn, ...r.waypoints];
}

const TANK_NORTH_PTS = routeFromPlan('tank_runway_north');
const EAST_TAXI_PTS = routeFromPlan('qrf_east_taxiway');

const SOUTH_GATE_SPAWNS = AIRBASE_ENEMY_SPAWNS.filter(s => s.section === 'southGate');
const APRON_SPAWNS = AIRBASE_ENEMY_SPAWNS.filter(s => s.section === 'fuelApron');
const ATC_SPAWNS = AIRBASE_ENEMY_SPAWNS.filter(s => s.section === 'atcTower');
const HANGAR_SPAWNS = AIRBASE_ENEMY_SPAWNS.filter(s => s.section === 'alertHangar');
const RUNWAY_SPAWNS = AIRBASE_ENEMY_SPAWNS.filter(s => s.section === 'runway');

const FUEL_SOUTH = AIRBASE_DESTRUCTIBLES.find(d => d.id === 'airbase.fuel.south')!;
const FUEL_NORTH = AIRBASE_DESTRUCTIBLES.find(d => d.id === 'airbase.fuel.north')!;

const MARKS: Readonly<Record<string, Mark>> = {
  // Checkpoints & squad rally marks
  perimeterStart: { at: AIRBASE_PLAYER_SPAWN, yaw: AIRBASE_PLAYER_YAW },
  southGateObj: { at: [0, 1.5, AIRBASE_SOUTH_GATE.z], yaw: 0 },
  apronStart: { at: [-24, 0, 98], yaw: 0 },
  towerStart: { at: [-40, 0, 4], yaw: -Math.PI * 0.25 },
  atcConsoleObj: { at: AIRBASE_ATC_CONSOLE.at, yaw: Math.PI * 0.25 },
  hangarStart: { at: [-14, 0, -28], yaw: -0.48 },
  alertHangarObj: { at: [AIRBASE_ALERT_HANGAR.x, 2, AIRBASE_ALERT_HANGAR.z], yaw: 0 },
  takeoffStart: { at: [AIRBASE_ALERT_HANGAR.x, 0, -48], yaw: 0 },
  lancerCockpit: { at: AIRBASE_LANCER_SPAWN.at, yaw: AIRBASE_LANCER_SPAWN.yaw },
  runwayThreshold: { at: AIRBASE_RUNWAY.northThreshold, yaw: AIRBASE_RUNWAY.headingYaw },
  takeoffBeacon: { at: AIRBASE_TAKEOFF_GATE.beaconAt, yaw: AIRBASE_RUNWAY.headingYaw },
  buddyRaptorWest: { at: AIRBASE_BUDDY_RAPTOR_SPAWNS[0]!.at, yaw: AIRBASE_BUDDY_RAPTOR_SPAWNS[0]!.yaw },
  buddyRaptorEast: { at: AIRBASE_BUDDY_RAPTOR_SPAWNS[1]!.at, yaw: AIRBASE_BUDDY_RAPTOR_SPAWNS[1]!.yaw },

  // Section 1: South Gate Garrison & Courtyard Guntruck
  sgWest: { at: SOUTH_GATE_SPAWNS[0]!.at, yaw: Math.PI },
  sgCenter: { at: SOUTH_GATE_SPAWNS[2]!.at, yaw: Math.PI },
  sgEast: { at: SOUTH_GATE_SPAWNS[4]!.at, yaw: Math.PI },
  sgGuntruck: { at: [3, 0, 102], yaw: Math.PI },

  // Section 2: Fuel Apron, JP-8 Pipeline Blockade & Hangar 02 Reinforcements
  fuelDepotSouth: { at: [FUEL_SOUTH.x, 0, FUEL_SOUTH.z], yaw: 0 },
  fuelDepotNorth: { at: [FUEL_NORTH.x, 0, FUEL_NORTH.z], yaw: 0 },
  apronSouthLine: { at: APRON_SPAWNS[1]!.at, yaw: Math.PI },
  apronCatwalk: { at: APRON_SPAWNS[3]!.at, yaw: APRON_SPAWNS[3]!.yaw },
  apronNorthLine: { at: APRON_SPAWNS[6]!.at, yaw: Math.PI },
  apronRoadblock: { at: [-18, 0, 22], yaw: Math.PI },
  apronHangarBay: { at: [-74, 0, 42], yaw: Math.PI / 2 },

  // Section 3: 3-Level ATC Tower (y = 0, 3.6, 7.2, 10.8)
  atcGround: { at: ATC_SPAWNS[0]!.at, yaw: Math.PI },
  atcLevel1: { at: ATC_SPAWNS[2]!.at, yaw: ATC_SPAWNS[2]!.yaw },
  atcLevel2: { at: ATC_SPAWNS[3]!.at, yaw: ATC_SPAWNS[3]!.yaw },
  atcLevel3: { at: ATC_SPAWNS[4]!.at, yaw: ATC_SPAWNS[4]!.yaw },

  // Section 4: Hardened Alert Hangar & Runway Perimeter
  hangarApronWest: { at: HANGAR_SPAWNS[0]!.at, yaw: Math.PI },
  hangarApronEast: { at: HANGAR_SPAWNS[1]!.at, yaw: Math.PI },
  hangarInterior: { at: HANGAR_SPAWNS[2]!.at, yaw: Math.PI },
  runwayGuards: { at: RUNWAY_SPAWNS[0]!.at, yaw: RUNWAY_SPAWNS[0]!.yaw },

  // Tank Runway North route
  tankNorth0: { at: [TANK_NORTH_PTS[0]![0], 0, TANK_NORTH_PTS[0]![1]], yaw: 0 },
  tankNorth1: { at: [TANK_NORTH_PTS[1]![0], 0, TANK_NORTH_PTS[1]![1]], yaw: 0 },
  tankNorth2: { at: [TANK_NORTH_PTS[2]![0], 0, TANK_NORTH_PTS[2]![1]], yaw: 0 },
  tankNorth3: { at: [TANK_NORTH_PTS[3]![0], 0, TANK_NORTH_PTS[3]![1]], yaw: 0 },

  // QRF East Taxiway Truck route
  qrfEast0: { at: [EAST_TAXI_PTS[0]![0], 0, EAST_TAXI_PTS[0]![1]], yaw: 0 },
  qrfEast1: { at: [EAST_TAXI_PTS[1]![0], 0, EAST_TAXI_PTS[1]![1]], yaw: 0 },
  qrfEast2: { at: [EAST_TAXI_PTS[2]![0], 0, EAST_TAXI_PTS[2]![1]], yaw: 0 },
  qrfEast3: { at: [EAST_TAXI_PTS[3]![0], 0, EAST_TAXI_PTS[3]![1]], yaw: 0 },

  // Field pickups & optional heavy weapon racks (exact `AIRBASE_PICKUPS` coordinates)
  dropGateAmmo: { at: AIRBASE_PICKUPS[1]!, yaw: 0 },
  dropApronHealth: { at: AIRBASE_PICKUPS[2]!, yaw: 0 },
  rackApronRocket: { at: AIRBASE_PICKUPS[4]!, yaw: 0 },
  dropTowerAmmo: { at: AIRBASE_PICKUPS[5]!, yaw: 0 },
  rackTowerSabot: { at: AIRBASE_PICKUPS[6]!, yaw: 0 },
  dropHangarHealth: { at: AIRBASE_PICKUPS[7]!, yaw: 0 },
  dropHangarAmmo: { at: AIRBASE_PICKUPS[8]!, yaw: 0 },
};

const ROUTES: Readonly<Record<string, readonly string[]>> = {
  tankRunwayNorth: ['tankNorth0', 'tankNorth1', 'tankNorth2', 'tankNorth3'],
  qrfEastTaxiway: ['qrfEast0', 'qrfEast1', 'qrfEast2', 'qrfEast3'],
};

const ZONES: Readonly<Record<string, Zone>> = {
  atcTower: zoneFromPlan('airbase-atc'),
  atcOpsCab: {
    min: [AIRBASE_ATC_TOWER.x - 8, AIRBASE_ATC_TOWER.cabFloorY - 1, AIRBASE_ATC_TOWER.z - 8],
    max: [AIRBASE_ATC_TOWER.x + 8, AIRBASE_ATC_TOWER.cabCeilY + 2, AIRBASE_ATC_TOWER.z + 8],
  },
  alertHangar: zoneFromPlan('airbase-alert-hangar'),
  runway: zoneFromPlan('airbase-runway'),
  takeoffGate: {
    min: [-220, AIRBASE_TAKEOFF_GATE.minAltitudeY, -640],
    max: [260, 300, AIRBASE_TAKEOFF_GATE.northZ],
  },
};

const DOORS: Readonly<Record<string, DoorDef>> = {
  'south.gate': {
    at: [0, 0, AIRBASE_SOUTH_GATE.z + 3],
    yaw: 0,
    width: 21.0,
    height: 6.0,
    kind: 'split',
    seconds: 0.14,
    start: 0,
    look: 'steelDark',
  },
  'apron.gate': {
    at: [AIRBASE_INNER_GATE.portalCenterX, 0, AIRBASE_INNER_GATE.z],
    yaw: 0,
    width: AIRBASE_INNER_GATE.portalHalfW * 2,
    height: AIRBASE_INNER_GATE.portalHeight,
    kind: 'split',
    seconds: 0.16,
    start: 0,
    look: 'steelDark',
  },
  'alert.south': {
    at: [AIRBASE_ALERT_HANGAR.x, 0, AIRBASE_ALERT_HANGAR.blastDoorSlot.southZ],
    yaw: 0,
    width: AIRBASE_ALERT_HANGAR.blastDoorSlot.width,
    height: AIRBASE_ALERT_HANGAR.blastDoorSlot.height,
    kind: 'split',
    seconds: 3.2,
    start: 0,
    look: 'steelDark',
  },
  'alert.north': {
    at: [AIRBASE_ALERT_HANGAR.x, 0, AIRBASE_ALERT_HANGAR.blastDoorSlot.northZ],
    yaw: 0,
    width: AIRBASE_ALERT_HANGAR.blastDoorSlot.width,
    height: AIRBASE_ALERT_HANGAR.blastDoorSlot.height,
    kind: 'split',
    seconds: 3.2,
    start: 0,
    look: 'steelDark',
  },
};

const CUTSCENES: Readonly<Record<string, Cutscene>> = {
  valkenOpening: {
    shots: [
      {
        // Shot 1: Sweeping dawn flyover over our staged assault column (Jackals, Aegis MBT, staging carriers)
        from: [-28, 12, 162],
        to: [18, 10, 146],
        lookFrom: [0, 2.5, 134],
        lookTo: [0, 2.8, 121],
        seconds: 5.6,
        fov: 48,
        fadeIn: 0.6,
        caption: 'VALKEN AIRBASE // SOUTH RADAR GATE — 05:40',
      },
      {
        // Shot 2: Aerial sweep showcasing the Fuel Apron, JP-8 Pipeline, locked Inner Blast Gate, ATC Tower & Alert Hangar
        from: [22, 18, 92],
        to: [-16, 16, 48],
        lookFrom: [-30, 3.0, 32],
        lookTo: [4, 5.5, -52],
        seconds: 5.4,
        fov: 50,
        caption: 'OBJECTIVE: BREACH PERIMETER // SEIZE B-1B LANCER',
      },
      {
        // Shot 3: Tight low-angle push-in on the blinking armed satchel charge right before detonation
        from: [7.5, 4.0, 132],
        to: [-3.0, 2.3, 125.5],
        lookFrom: [0, 2.0, 121],
        lookTo: [0, 1.5, 121],
        seconds: 4.6,
        fov: 44,
        fadeOut: 0.35,
        caption: 'BREACH CHARGE ARMED // FORM 7742-W',
      },
    ],
  },
};

export const CROSSFIRE_AIRBASE: Mission = {
  id: 'crossfire_airbase',
  title: 'Crossfire — Valken Airbase',
  corpses: 36,
  loadout: RAID_LOADOUT,
  redeployLines: CROSSFIRE_AIRBASE_REDEPLOY,
  lines: CROSSFIRE_AIRBASE_LINES,
  marks: MARKS,
  zones: ZONES,
  doors: DOORS,
  routes: ROUTES,
  cutscenes: CUTSCENES,

  beats: [
    // -------------------------------------------------------------------------------------------
    // Section 1: South Perimeter & Radar Gate
    // -------------------------------------------------------------------------------------------
    {
      id: 'perimeter',
      title: 'South Perimeter Breach',
      checkpoint: { at: 'perimeterStart', loadout: RAID_LOADOUT },
      start: [
        { do: 'callins', held: true },
        { do: 'threat', level: 4, grade: 'regular' },
        { do: 'music', state: 'easy' },
        { do: 'door', door: 'south.gate', open: 0, seconds: 0 },
        { do: 'door', door: 'apron.gate', open: 0, seconds: 0 },
        { do: 'door', door: 'alert.south', open: 0, seconds: 0 },
        { do: 'door', door: 'alert.north', open: 0, seconds: 0 },
        { do: 'call', name: 'cf.airbaseInit', arg: 'buddyRaptorWest,buddyRaptorEast' },
        { do: 'roster', men: VIPER_SQUAD, at: 'perimeterStart' },
        { do: 'drop', item: 'ammo', at: 'dropGateAmmo' },
        // Pre-stage Northern defenders + courtyard guntruck behind the closed gate (zero open-tarmac pop-in!)
        { do: 'squad', tag: 'sg_west', men: ['trooper', 'trooper', 'gunner'], at: 'sgWest', orders: 'hold', ensure: true },
        { do: 'squad', tag: 'sg_center', men: ['trooper', 'brute', 'gunner', 'rocketeer'], at: 'sgCenter', orders: 'hold', ensure: true },
        { do: 'squad', tag: 'sg_east', men: ['trooper', 'warden', 'trooper'], at: 'sgEast', orders: 'hold', ensure: true },
        { do: 'vehicle', tag: 'sg_guntruck', kind: 'humvee', at: 'sgGuntruck', holds: 'sgGuntruck', crew: ['trooper', 'gunner'], crewTag: 'sg_crew', ensure: true },
        say('council.brief.1'),
        say('council.brief.2'),
        { do: 'cutscene', id: 'valkenOpening' },
        { do: 'door', door: 'south.gate', open: 1, seconds: 0.14 },
        { do: 'call', name: 'cf.airbaseBreach' },
        { do: 'banner', text: 'CROSSFIRE', sub: 'VALKEN AIRBASE // PART 01 OF 04' },
        say('wingman.perimeter.start'),
        { do: 'objective', id: 'breach_gate', text: 'Breach the South Radar Gate and clear the courtyard defenders & guntruck', at: 'southGateObj' },
        { do: 'hint', text: 'Assault armor, Viper-2/3, and your 4-man squad are pushing with you — press {interact} on squadmates for hold/follow orders.', seconds: 8 },
        {
          do: 'until',
          when: {
            cleared: ['sg_west', 'sg_center', 'sg_east', 'sg_guntruck'],
          },
        },
        { do: 'done', id: 'breach_gate' },
        say('wingman.perimeter.clear'),
        { do: 'goto', beat: 'apron' },
      ],
      cues: [
        {
          when: { any: [{ kills: 1 }, { after: 5 }] },
          run: [
            { do: 'music', state: 'hard' },
            say('darrow.perimeter.lockdown', { within: 8 }),
          ],
        },
      ],
    },

    // -------------------------------------------------------------------------------------------
    // Section 2: Fuel Apron & JP-8 Inner Blast Gate Blockade (Option A Hard Gate)
    // -------------------------------------------------------------------------------------------
    {
      id: 'apron',
      title: 'JP-8 Fuel Apron Blockade',
      checkpoint: { at: 'apronStart', loadout: RAID_LOADOUT },
      start: [
        { do: 'callins', held: true },
        { do: 'threat', level: 5, grade: 'regular' },
        { do: 'music', state: 'hard' },
        { do: 'sweep', tag: 'sg_west' },
        { do: 'sweep', tag: 'sg_center' },
        { do: 'sweep', tag: 'sg_east' },
        { do: 'sweep', tag: 'sg_crew' },
        { do: 'sweep', tag: 'sg_guntruck' },
        { do: 'door', door: 'south.gate', open: 1, seconds: 0 },
        { do: 'door', door: 'apron.gate', open: 0, seconds: 0 },
        { do: 'door', door: 'alert.south', open: 0, seconds: 0 },
        { do: 'door', door: 'alert.north', open: 0, seconds: 0 },
        { do: 'roster', men: VIPER_SQUAD, at: 'apronStart' },
        { do: 'banner', text: 'INNER BLAST GATE LOCKDOWN', sub: 'BLOW THE MARKED JP-8 FUEL DEPOTS TO BREACH' },
        { do: 'drop', item: 'health', at: 'dropApronHealth' },
        { do: 'rack', weapon: 'rocket', at: 'rackApronRocket', optional: true, label: 'ANTI-ARMOR ROCKET LAUNCHER' },
        { do: 'call', name: 'cf.apronFuelWatch', arg: 'fuelDepotSouth,fuelDepotNorth' },
        { do: 'squad', tag: 'apron_south', men: ['trooper', 'gunner', 'trooper', 'riot'], at: 'apronSouthLine', ensure: true },
        { do: 'squad', tag: 'apron_catwalk', men: ['sniper', 'trooper', 'gunner'], at: 'apronCatwalk', orders: 'hold', ensure: true },
        { do: 'squad', tag: 'apron_north', men: ['trooper', 'brute', 'rocketeer', 'gunner'], at: 'apronNorthLine', ensure: true },
        { do: 'vehicle', tag: 'apron_tank', kind: 'tank', at: 'apronRoadblock', holds: 'apronRoadblock', ensure: true },
        say('wingman.apron.fuel'),
        { do: 'objective', id: 'blow_jp8_gate', text: 'Detonate the marked JP-8 Fuel Depots to rupture the pipeline and blow the Inner Blast Gate', at: 'fuelDepotNorth' },
        { do: 'hint', text: 'Inner Blast Gate is sealed and enemy reinforcements keep pouring from Hangar 02 — shoot, satchel, or rocket the marked JP-8 Fuel Depots!', seconds: 9 },
        { do: 'until', when: { signal: CROSSFIRE_SIGNALS.fuelBlown } },
        { do: 'done', id: 'blow_jp8_gate' },
        // Sync physical blast-gate opening right on Stage 3 of the 3-stage pipeline chain detonation!
        { do: 'wait', seconds: 0.7 },
        { do: 'door', door: 'apron.gate', open: 1, seconds: 0.16 },
        say('wingman.apron.fuel_blown'),
        { do: 'until', when: { any: [{ zone: 'atcTower' }, { after: 3.5 }] } },
        { do: 'goto', beat: 'tower' },
      ],
      cues: [
        {
          when: { after: 7 },
          run: [say('darrow.apron.qrf', { within: 8 })],
        },
        // Continuous Northern reinforcements pouring from concealed Maintenance Hangar 02 until JP-8 blows!
        {
          when: { all: [{ left: 3, tag: 'apron_north' }, { after: 6 }] },
          repeat: true,
          run: [
            { do: 'squad', tag: 'apron_north', men: ['trooper', 'gunner', 'rocketeer', 'trooper'], at: 'apronHangarBay' },
          ],
        },
      ],
    },

    // -------------------------------------------------------------------------------------------
    // Section 3: 3-Level Air Traffic Control Tower (y = 0 -> 10.8) & IFF Override Console
    // -------------------------------------------------------------------------------------------
    {
      id: 'tower',
      title: 'ATC Flight-Ops Tower',
      checkpoint: { at: 'towerStart', loadout: RAID_LOADOUT },
      start: [
        { do: 'callins', held: true },
        { do: 'threat', level: 5, grade: 'veteran' },
        { do: 'music', state: 'hard' },
        { do: 'sweep', tag: 'apron_south' },
        { do: 'sweep', tag: 'apron_catwalk' },
        { do: 'sweep', tag: 'apron_north' },
        { do: 'sweep', tag: 'apron_tank' },
        { do: 'door', door: 'south.gate', open: 1, seconds: 0 },
        { do: 'door', door: 'apron.gate', open: 1, seconds: 0 },
        { do: 'door', door: 'alert.south', open: 0, seconds: 0 },
        { do: 'door', door: 'alert.north', open: 0, seconds: 0 },
        { do: 'roster', men: VIPER_SQUAD, at: 'towerStart' },
        { do: 'banner', text: 'ATC FLIGHT-OPS TOWER', sub: 'LEVELS 0 -> 3 // HANGAR OVERRIDE & IFF SPOOF' },
        { do: 'drop', item: 'ammo', at: 'dropTowerAmmo' },
        { do: 'rack', weapon: 'sabot', at: 'rackTowerSabot', optional: true, label: 'SABOT ANTI-MATERIEL RIFLE' },
        { do: 'squad', tag: 'atc_ground', men: ['trooper', 'brute', 'riot'], at: 'atcGround', orders: 'hold', ensure: true },
        { do: 'squad', tag: 'atc_l1', men: ['trooper', 'gunner', 'trooper'], at: 'atcLevel1', orders: 'hold', ensure: true },
        { do: 'squad', tag: 'atc_l2', men: ['sniper', 'gunner', 'riot'], at: 'atcLevel2', orders: 'hold', ensure: true },
        { do: 'squad', tag: 'atc_l3', men: ['warden', 'trooper', 'gunner'], at: 'atcLevel3', orders: 'hold', ensure: true },
        { do: 'call', name: 'cf.atcConsole', arg: 'atcConsoleObj' },
        say('wingman.tower.enter'),
        { do: 'objective', id: 'override_atc', text: 'Climb the 3-level ATC Tower and trigger the Hangar Override & IFF Spoof Console', at: 'atcConsoleObj' },
        { do: 'hint', text: 'Fight up the interior stairs to Flight Ops (y = 10.8 m) and press {interact} on the Hangar Override Console.', seconds: 8 },
        { do: 'until', when: { signal: CROSSFIRE_SIGNALS.atcOverrideDone } },
        { do: 'done', id: 'override_atc' },
        { do: 'door', door: 'alert.south', open: 1, seconds: 3.2 },
        { do: 'door', door: 'alert.north', open: 1, seconds: 3.2 },
        say('wingman.tower.override_done'),
        say('darrow.tower.breached'),
        { do: 'wait', seconds: 1.5 },
        { do: 'goto', beat: 'hangar' },
      ],
      cues: [
        {
          when: { zone: 'atcTower' },
          run: [
            say('darrow.tower.warning', { within: 8 }),
            { do: 'release', tag: 'atc_l1' },
          ],
        },
        {
          when: { zone: 'atcOpsCab' },
          run: [
            say('council.tower.iff', { within: 8 }),
            { do: 'release', tag: 'atc_l3' },
          ],
        },
      ],
    },

    // -------------------------------------------------------------------------------------------
    // Section 4: Hardened Alert Hangar & Darrow's Armored QRF Push
    // -------------------------------------------------------------------------------------------
    {
      id: 'hangar',
      title: 'Alert Hangar Assault',
      checkpoint: { at: 'hangarStart', loadout: RAID_LOADOUT },
      start: [
        { do: 'callins', held: true },
        { do: 'threat', level: 6, grade: 'veteran' },
        { do: 'music', state: 'hard' },
        { do: 'sweep', tag: 'atc_ground' },
        { do: 'sweep', tag: 'atc_l1' },
        { do: 'sweep', tag: 'atc_l2' },
        { do: 'sweep', tag: 'atc_l3' },
        { do: 'door', door: 'south.gate', open: 1, seconds: 0 },
        { do: 'door', door: 'apron.gate', open: 1, seconds: 0 },
        { do: 'door', door: 'alert.south', open: 1, seconds: 0 },
        { do: 'door', door: 'alert.north', open: 1, seconds: 0 },
        { do: 'roster', men: VIPER_SQUAD, at: 'hangarStart' },
        { do: 'banner', text: 'HARDENED ALERT HANGAR', sub: 'B-1B LANCER // ARMORED QRF COUNTERATTACK' },
        { do: 'drop', item: 'health', at: 'dropHangarHealth' },
        { do: 'drop', item: 'ammo', at: 'dropHangarAmmo' },
        { do: 'call', name: 'cf.buddyRaptorsBoard', arg: 'buddyRaptorWest,buddyRaptorEast' },
        { do: 'squad', tag: 'hangar_west', men: ['brute', 'gunner', 'trooper'], at: 'hangarApronWest', ensure: true },
        { do: 'squad', tag: 'hangar_east', men: ['trooper', 'rocketeer', 'gunner'], at: 'hangarApronEast', ensure: true },
        { do: 'squad', tag: 'hangar_vault', men: ['warden', 'riot', 'trooper', 'rocketeer'], at: 'hangarInterior', orders: 'hold', ensure: true },
        { do: 'squad', tag: 'runway_def', men: ['brute', 'rocketeer', 'gunner'], at: 'runwayGuards', orders: 'hold', ensure: true },
        { do: 'vehicle', tag: 'darrow_tank', kind: 'tank', at: 'tankNorth0', route: 'tankRunwayNorth', holds: 'tankNorth2', ensure: true },
        { do: 'vehicle', tag: 'darrow_qrf', kind: 'truck', at: 'qrfEast0', route: 'qrfEastTaxiway', crew: ['trooper', 'gunner', 'riot', 'trooper'], crewTag: 'hangar_qrf_crew', ensure: true },
        say('wingman.hangar.push'),
        { do: 'objective', id: 'secure_hangar', text: 'Destroy Darrow’s armored QRF push and secure the Alert Hangar', at: 'alertHangarObj' },
        { do: 'hint', text: 'Our Aegis tank is engaging Darrow’s MBT — smash their line while Viper-2 and Viper-3 sprint into the parked F-22 Raptors!', seconds: 8 },
        {
          do: 'until',
          when: {
            any: [
              { cleared: ['darrow_tank', 'hangar_west', 'hangar_east', 'hangar_vault'] },
              { all: [{ zone: 'alertHangar' }, { cleared: ['darrow_tank', 'hangar_vault'] }] },
            ],
          },
        },
        { do: 'done', id: 'secure_hangar' },
        { do: 'goto', beat: 'takeoff' },
      ],
      cues: [
        {
          when: { any: [{ signal: CROSSFIRE_SIGNALS.raptorsSpooled }, { after: 14 }] },
          run: [
            say('wingman.hangar.raptors_boarding'),
            say('darrow.hangar.desperate', { within: 8 }),
          ],
        },
        {
          when: { zone: 'alertHangar' },
          run: [
            { do: 'release', tag: 'hangar_vault' },
            { do: 'release', tag: 'runway_def' },
          ],
        },
      ],
    },

    // -------------------------------------------------------------------------------------------
    // Section 5: Board the 28.2 m B-1B Lancer & Runway Takeoff
    // -------------------------------------------------------------------------------------------
    {
      id: 'takeoff',
      title: 'Runway 01/19 Takeoff',
      checkpoint: { at: 'takeoffStart', loadout: RAID_LOADOUT },
      start: [
        { do: 'callins', held: true },
        { do: 'sweep', tag: 'hangar_west' },
        { do: 'sweep', tag: 'hangar_east' },
        { do: 'sweep', tag: 'hangar_vault' },
        { do: 'sweep', tag: 'hangar_qrf_crew' },
        { do: 'door', door: 'south.gate', open: 1, seconds: 0 },
        { do: 'door', door: 'apron.gate', open: 1, seconds: 0 },
        { do: 'door', door: 'alert.south', open: 1, seconds: 0 },
        { do: 'door', door: 'alert.north', open: 1, seconds: 0 },
        { do: 'music', state: 'hard' },
        { do: 'banner', text: 'WEAPONS HOT // LAUNCH', sub: 'B-1B LANCER // RUNWAY 01/19' },
        { do: 'call', name: 'cf.lancerReady', arg: 'lancerCockpit,runwayThreshold,takeoffBeacon' },
        say('wingman.takeoff.board'),
        { do: 'objective', id: 'board_lancer', text: 'Climb into the B-1B Lancer inside the Alert Hangar', at: 'lancerCockpit' },
        { do: 'hint', text: 'Press {interact} at the B-1B Lancer to climb into the cockpit, taxi onto the 300 m runway, and hit full afterburner!', seconds: 9 },
        { do: 'until', when: { signal: CROSSFIRE_SIGNALS.lancerBoarded } },
        { do: 'done', id: 'board_lancer' },
        { do: 'call', name: 'cf.buddyRaptorsTakeoff', arg: 'buddyRaptorWest,buddyRaptorEast' },
        say('wingman.takeoff.rolling'),
        { do: 'objective', id: 'lancer_takeoff', text: 'Taxi onto Runway 01/19, ignite afterburners, and climb out north', at: 'takeoffBeacon' },
        {
          do: 'until',
          when: {
            any: [
              { signal: CROSSFIRE_SIGNALS.lancerAirborne },
              { zone: 'takeoffGate' },
            ],
          },
        },
        { do: 'done', id: 'lancer_takeoff' },
        say('darrow.takeoff.airborne'),
        say('council.takeoff.handoff', { wait: true }),
        { do: 'call', name: 'cf.handoffToStrait' },
        { do: 'wait', seconds: 2.0 },
        { do: 'finish' },
      ],
      cues: [
        {
          when: { zone: 'runway' },
          run: [
            { do: 'hint', text: 'Aligned on Runway 01/19 — push throttle to afterburner and pitch up past the north threshold!', seconds: 6 },
          ],
        },
      ],
    },
  ],
};
