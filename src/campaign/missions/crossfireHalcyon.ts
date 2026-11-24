/**
 * Crossfire Part 3 — "Fortress Halcyon" (`map: 'halcyon'`, Contractor #7712-A, flagship ~12–15 min).
 *
 * Contractor A pilots the overhauled 4-mode B-1B Lancer (36x Snake-Eyes, 16x CBU-105 Heavy Cluster,
 * 18x Napalm, 6x BLU-121/B Thermobaric) over Fortress Halcyon alongside Captain Mercer's full-scale
 * Bureau combined-arms invasion:
 *   1. breach            — Blow Section B of the South Blast Wall & silence outer Flak Bastions for Mercer's beachhead armor
 *   2. ridge_suppression — Wipe forward Mortar Trenches (CBU-105 Cluster!) & outer SAM Batteries so Valkyrie choppers fast-rope into the courtyard
 *   3. war_machine       — Open-hunting combined-arms climax: flatten Tank Armory, Hardened Hangars & Flight Line, Fuel Farm, Radar Domes & Barracks
 *   4. citadel_hq        — Shatter Halvorsen's Tier-3 Reinforced Command HQ with BLU-121 Thermobaric bombs -> dusk sea egress handoff
 */
import { HALCYON_DISTRICTS } from '../../world/map/halcyon/plan';
import {
  HALCYON_AIR_PATROLS,
  HALCYON_CHOPPER_LZS,
  getHalcyonTarget,
} from '../../world/map/halcyon/targets';
import { CROSSFIRE_SIGNALS } from '../crossfire/chain';
import type { Cutscene, Loadout, Mark, Mission, Step, Zone } from '../types';
import { CROSSFIRE_HALCYON_LINES, CROSSFIRE_HALCYON_REDEPLOY } from './crossfire.lines';

const say = (key: string, opts: { wait?: boolean; now?: boolean; again?: boolean; within?: number } = {}): Step => ({
  do: 'say',
  line: `mission.crossfire.halcyon.${key}`,
  ...opts,
});

const BOMBER_LOADOUT: Loadout = {
  weapons: ['smg', 'ultramag', 'knife'],
  grenades: 2,
};

/** Exact `HALCYON_TARGETS` IDs grouped by mission phase for the Crossfire Part 3 runtime director. */
export const HALCYON_MISSION_TARGET_GROUPS = {
  breach: ['wall_section_b', 'flak_west', 'flak_east'] as const,
  ridgeSuppression: ['mortar_west', 'mortar_center', 'mortar_east', 'sam_sw', 'sam_se'] as const,
  warMachine: [
    'tank_armory_depot',
    'tank_armory_motor_pool',
    'hangar_north',
    'hangar_south',
    'flightline_fighters',
    'flightline_choppers',
    'fuel_tank_farm',
    'ammo_bunker_depot',
    'radar_west',
    'radar_east',
    'barracks_west',
    'barracks_east',
    'barracks_north',
    'sam_nw',
    'sam_ne',
  ] as const,
  citadelHq: ['citadel_command_hq', 'flak_north'] as const,
} as const;

const CORRIDOR_SN = HALCYON_AIR_PATROLS.find(p => p.id === 'corridor_b1b_south_north')!;
const CORRIDOR_WE = HALCYON_AIR_PATROLS.find(p => p.id === 'corridor_b1b_west_east')!;

const TARGET_SECTION_B = getHalcyonTarget('wall_section_b')!;
const TARGET_FLAK_WEST = getHalcyonTarget('flak_west')!;
const TARGET_FLAK_EAST = getHalcyonTarget('flak_east')!;
const TARGET_MORTAR_CENTER = getHalcyonTarget('mortar_center')!;
const TARGET_SAM_SW = getHalcyonTarget('sam_sw')!;
const TARGET_SAM_SE = getHalcyonTarget('sam_se')!;
const TARGET_ARMORY = getHalcyonTarget('tank_armory_depot')!;
const TARGET_HANGAR_N = getHalcyonTarget('hangar_north')!;
const TARGET_FUEL_FARM = getHalcyonTarget('fuel_tank_farm')!;
const TARGET_RADAR_W = getHalcyonTarget('radar_west')!;
const TARGET_CITADEL_HQ = getHalcyonTarget('citadel_command_hq')!;

const LZ_INNER_W = HALCYON_CHOPPER_LZS.find(lz => lz.id === 'lz_inner_west')!;
const LZ_INNER_E = HALCYON_CHOPPER_LZS.find(lz => lz.id === 'lz_inner_east')!;

const MARKS: Readonly<Record<string, Mark>> = {
  // Bomber airborne checkpoints along Halcyon bombing corridors
  lancerApproach: { at: CORRIDOR_SN.waypoints[0]!, yaw: Math.PI },
  lancerRidgePass: { at: [-260, 122, 420], yaw: Math.PI },
  lancerWarOrbit: { at: CORRIDOR_WE.waypoints[0]!, yaw: Math.PI * 0.5 },
  lancerCitadelRun: { at: [0, 128, 460], yaw: Math.PI },

  // Key target & LZ world markers (exact `targets.ts` coordinates)
  wallSectionB: { at: TARGET_SECTION_B.pos, yaw: 0 },
  flakWest: { at: TARGET_FLAK_WEST.pos, yaw: 0 },
  flakEast: { at: TARGET_FLAK_EAST.pos, yaw: 0 },
  mortarCenter: { at: TARGET_MORTAR_CENTER.pos, yaw: 0 },
  samSw: { at: TARGET_SAM_SW.pos, yaw: 0 },
  samSe: { at: TARGET_SAM_SE.pos, yaw: 0 },
  lzInnerWest: { at: LZ_INNER_W.pos, yaw: 0 },
  lzInnerEast: { at: LZ_INNER_E.pos, yaw: 0 },
  tankArmory: { at: TARGET_ARMORY.pos, yaw: 0 },
  hangarNorth: { at: TARGET_HANGAR_N.pos, yaw: 0 },
  fuelFarm: { at: TARGET_FUEL_FARM.pos, yaw: 0 },
  radarWest: { at: TARGET_RADAR_W.pos, yaw: 0 },
  citadelHq: { at: TARGET_CITADEL_HQ.pos, yaw: 0 },
};

const ZONES: Readonly<Record<string, Zone>> = {
  citadelAirspace: {
    min: [HALCYON_DISTRICTS.citadel.x0 - 30, 20, HALCYON_DISTRICTS.citadel.z0 - 30],
    max: [HALCYON_DISTRICTS.citadel.x1 + 30, 280, HALCYON_DISTRICTS.citadel.z1 + 30],
  },
};

const CUTSCENES: Readonly<Record<string, Cutscene>> = {
  halcyonFlyIn: {
    shots: [
      {
        from: [140, 92, 340],
        to: [42, 74, 180],
        lookFrom: [0, 8, 98],
        lookTo: [0, 10, -30],
        seconds: 4.2,
        fov: 50,
        fadeIn: 0.7,
        fadeOut: 0.4,
        caption: 'FORTRESS HALCYON // SOUTHERN DIRECTORATE — COMBINED-ARMS ASSAULT',
      },
    ],
  },
};

export const CROSSFIRE_HALCYON: Mission = {
  id: 'crossfire_halcyon',
  title: 'Crossfire — Fortress Halcyon',
  corpses: 36,
  loadout: BOMBER_LOADOUT,
  redeployLines: CROSSFIRE_HALCYON_REDEPLOY,
  lines: CROSSFIRE_HALCYON_LINES,
  marks: MARKS,
  zones: ZONES,
  doors: {},
  routes: {},
  cutscenes: CUTSCENES,

  beats: [
    // -------------------------------------------------------------------------------------------
    // Section 1: Beachhead Breach (Section B South Blast Wall + Outer Flak Bastions)
    // -------------------------------------------------------------------------------------------
    {
      id: 'breach',
      title: 'Beachhead Breach — Section B',
      checkpoint: { at: 'lancerApproach', loadout: BOMBER_LOADOUT },
      start: [
        { do: 'callins', held: true },
        { do: 'threat', level: 6, grade: 'veteran' },
        { do: 'music', state: 'hard' },
        { do: 'call', name: 'cf.halcyonInit', arg: 'lancerApproach' },
        { do: 'cutscene', id: 'halcyonFlyIn' },
        { do: 'banner', text: 'FORTRESS HALCYON', sub: 'PART 03 OF 04 // B-1B LANCER COMBINED-ARMS ASSAULT' },
        say('council.arrive'),
        say('mercer.breach.call'),
        say('wingman.breach.escort'),
        { do: 'call', name: 'cf.halcyonBreachWatch', arg: 'wallSectionB,flakWest,flakEast' },
        { do: 'objective', id: 'breach_wall', text: 'Blow open Section B of the South Blast Wall and silence both outer Flak Bastions', at: 'wallSectionB' },
        { do: 'hint', text: 'You pilot the B-1B Lancer! Cycle 4 bomb modes (Snake-Eyes, CBU-105 Cluster, Napalm, BLU-121 Thermobaric) — smash Section B [0, 0, 98] so Mercer’s tanks can pour in!', seconds: 9 },
        { do: 'until', when: { signal: CROSSFIRE_SIGNALS.halcyonBreached } },
        { do: 'done', id: 'breach_wall' },
        say('mercer.breach.open', { now: true }),
        { do: 'goto', beat: 'ridge_suppression' },
      ],
      cues: [
        {
          when: { after: 12 },
          run: [say('halvorsen.breach.shock')],
        },
      ],
    },

    // -------------------------------------------------------------------------------------------
    // Section 2: Ridge Suppression (Mortar Trenches, Outer SAMs & Valkyrie Fast-Rope Assault)
    // -------------------------------------------------------------------------------------------
    {
      id: 'ridge_suppression',
      title: 'Ridge Suppression & Valkyrie Drop',
      checkpoint: { at: 'lancerRidgePass', loadout: BOMBER_LOADOUT },
      start: [
        { do: 'callins', held: true },
        { do: 'threat', level: 7, grade: 'veteran' },
        { do: 'music', state: 'hard' },
        { do: 'banner', text: 'RIDGE SUPPRESSION', sub: 'MORTAR TRENCHES & SAM BATTERIES // VALKYRIE ASSAULT' },
        { do: 'call', name: 'cf.halcyonArmorPush', arg: 'mortarCenter,samSw,samSe' },
        say('halvorsen.ridge.traps'),
        say('mercer.ridge.pinned', { now: true }),
        { do: 'objective', id: 'suppress_ridge', text: 'Wipe the 3 Mortar Trenches and outer SAM Batteries to clear the Valkyrie drop', at: 'mortarCenter' },
        { do: 'hint', text: 'Select CBU-105 Heavy Cluster bombs to saturate the forward mortar trenches, then knock out SAM Battery Alpha (SW) and Bravo (SE)!', seconds: 9 },
        { do: 'until', when: { signal: CROSSFIRE_SIGNALS.halcyonRidgeClear } },
        { do: 'done', id: 'suppress_ridge' },
        { do: 'call', name: 'cf.halcyonValkyrieDrop', arg: 'lzInnerWest,lzInnerEast' },
        say('mercer.ridge.clear', { now: true }),
        say('wingman.ridge.valkyries'),
        { do: 'wait', seconds: 2.0 },
        { do: 'goto', beat: 'war_machine' },
      ],
    },

    // -------------------------------------------------------------------------------------------
    // Section 3: War Machine Open-Hunting Combined-Arms Climax
    // -------------------------------------------------------------------------------------------
    {
      id: 'war_machine',
      title: 'Shatter the War Machine',
      checkpoint: { at: 'lancerWarOrbit', loadout: BOMBER_LOADOUT },
      start: [
        { do: 'callins', held: true },
        { do: 'threat', level: 8, grade: 'veteran' },
        { do: 'music', state: 'hard' },
        { do: 'banner', text: 'TOTAL WAR // HALCYON', sub: 'ARMORY · HANGARS · FUEL FARM · RADARS · BARRACKS' },
        { do: 'call', name: 'cf.halcyonWarMachine', arg: 'tankArmory,hangarNorth,fuelFarm,radarWest' },
        say('halvorsen.warmachine.unleash', { now: true }),
        say('mercer.warmachine.hunt'),
        { do: 'objective', id: 'flatten_halcyon', text: 'Flatten Halcyon’s Tank Armory, Hardened Hangars, Fuel Farm, Radar Domes & Barracks', at: 'tankArmory' },
        { do: 'hint', text: 'Open hunting! Use Napalm on the NW Fuel Farm & NE Barracks, Snake-Eyes & Cluster on the Tank Armory and Airfield flight line!', seconds: 9 },
        { do: 'until', when: { signal: CROSSFIRE_SIGNALS.halcyonWarBroken } },
        { do: 'done', id: 'flatten_halcyon' },
        say('mercer.warmachine.broken', { now: true }),
        { do: 'goto', beat: 'citadel_hq' },
      ],
      cues: [
        {
          when: { signal: CROSSFIRE_SIGNALS.halcyonArmoryDown },
          run: [say('mercer.warmachine.armory_down')],
        },
        {
          when: { signal: CROSSFIRE_SIGNALS.halcyonAirfieldDown },
          run: [say('wingman.warmachine.airfield_down')],
        },
        {
          when: { signal: CROSSFIRE_SIGNALS.halcyonFuelDown },
          run: [
            say('mercer.warmachine.fuel_down'),
            say('halvorsen.warmachine.cracking'),
          ],
        },
        {
          when: { signal: CROSSFIRE_SIGNALS.halcyonRadarDown },
          run: [
            { do: 'hint', text: 'Early-warning radar domes destroyed — remaining SAM lock speed severely degraded!', seconds: 6 },
          ],
        },
      ],
    },

    // -------------------------------------------------------------------------------------------
    // Section 4: Center Citadel — Tier-3 Reinforced Command HQ & Dusk Sea Egress
    // -------------------------------------------------------------------------------------------
    {
      id: 'citadel_hq',
      title: 'Citadel Command HQ',
      checkpoint: { at: 'lancerCitadelRun', loadout: BOMBER_LOADOUT },
      start: [
        { do: 'callins', held: true },
        { do: 'threat', level: 8, grade: 'veteran' },
        { do: 'music', state: 'hard' },
        { do: 'banner', text: 'CENTER CITADEL', sub: 'TIER-3 COMMAND HQ // BLU-121 THERMOBARIC AUTHORIZED' },
        { do: 'call', name: 'cf.halcyonCitadelSiege', arg: 'citadelHq' },
        say('halvorsen.citadel.seal', { now: true }),
        say('mercer.citadel.thermobaric'),
        { do: 'objective', id: 'destroy_citadel', text: 'Level Fortress Halcyon Command HQ with BLU-121 Thermobaric bombs', at: 'citadelHq' },
        { do: 'hint', text: 'Switch to BLU-121/B Thermobaric bombs to shatter the Tier-3 Reinforced Command HQ in the center plaza!', seconds: 9 },
        { do: 'until', when: { signal: CROSSFIRE_SIGNALS.halcyonHqDestroyed } },
        { do: 'done', id: 'destroy_citadel' },
        say('halvorsen.citadel.final', { now: true }),
        say('mercer.citadel.destroyed'),
        { do: 'call', name: 'cf.halcyonLeveled' },
        { do: 'until', when: { any: [{ signal: CROSSFIRE_SIGNALS.halcyonEgressReady }, { after: 6 }] } },
        say('wingman.egress.damage'),
        say('council.handoff.return', { wait: true }),
        { do: 'call', name: 'cf.handoffToReturn' },
        { do: 'wait', seconds: 2.0 },
        { do: 'finish' },
      ],
      cues: [
        {
          when: { zone: 'citadelAirspace' },
          run: [
            { do: 'hint', text: 'Over the Citadel plaza — release BLU-121 Thermobaric straight onto the Command HQ roof!', seconds: 6 },
          ],
        },
      ],
    },
  ],
};
