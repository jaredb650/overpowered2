/**
 * Crossfire Part 2 — "The Strait" (`map: 'strait'`, Contractor #7712-B, tight ~5–6 min).
 *
 * Contractor B flies the F-22 Raptor escorting the 7,500 HP AI-piloted B-1B Lancer north across
 * the open sea toward Fortress Halcyon's smoking coastline:
 *   1. outbound_probe     — Darrow tries to warn Halcyon on emergency guard; Council jams him; 3 Hornets intercept over sea stacks
 *   2. destroyer_gauntlet — General Halvorsen takes comms; 2 Southern Missile Destroyers light up SeaRAM SAMs & CIWS + 3 Harriers & 2 Warthogs
 *   3. coastal_aces       — Halvorsen scrambles Raptor Ace + Hornet CAP before the Lancer hits `STRAIT_FEET_DRY_Z` -> Halcyon handoff
 */
import {
  STRAIT_COASTAL_RADARS,
  STRAIT_DESTROYERS,
  STRAIT_FEET_DRY_Z,
  STRAIT_OUTBOUND_LANCER_PATH,
  STRAIT_OUTBOUND_PLAYER_SPAWN,
} from '../../world/map/strait/plan';
import { CROSSFIRE_SIGNALS } from '../crossfire/chain';
import type { Cutscene, Loadout, Mark, Mission, Step, Zone } from '../types';
import { CROSSFIRE_STRAIT_LINES, CROSSFIRE_STRAIT_REDEPLOY } from './crossfire.lines';

const say = (key: string, opts: { wait?: boolean; now?: boolean; again?: boolean; within?: number } = {}): Step => ({
  do: 'say',
  line: `mission.crossfire.strait.${key}`,
  ...opts,
});

const PILOT_LOADOUT: Loadout = {
  weapons: ['smg', 'ultramag', 'knife'],
  grenades: 2,
};

const DESTROYER_WEST = STRAIT_DESTROYERS[0]!;
const DESTROYER_EAST = STRAIT_DESTROYERS[1]!;
const HALCYON_COAST_RADAR = STRAIT_COASTAL_RADARS[1]!;

const MARKS: Readonly<Record<string, Mark>> = {
  outboundStart: { at: STRAIT_OUTBOUND_PLAYER_SPAWN.at, yaw: STRAIT_OUTBOUND_PLAYER_SPAWN.yaw },
  midStraitCheck: { at: [30, 104, 55], yaw: Math.PI },
  coastalCheck: { at: [24, 114, -220], yaw: Math.PI },
  lancerStart: { at: STRAIT_OUTBOUND_LANCER_PATH[0]!, yaw: Math.PI },
  lancerMid: { at: STRAIT_OUTBOUND_LANCER_PATH[2]!, yaw: Math.PI },
  lancerFeetDry: { at: STRAIT_OUTBOUND_LANCER_PATH[5]!, yaw: Math.PI },
  destroyerWest: { at: [DESTROYER_WEST.x, 12, DESTROYER_WEST.z], yaw: DESTROYER_WEST.yaw },
  destroyerEast: { at: [DESTROYER_EAST.x, 12, DESTROYER_EAST.z], yaw: DESTROYER_EAST.yaw },
  halcyonCoastObj: { at: [HALCYON_COAST_RADAR.x, HALCYON_COAST_RADAR.baseY + 28, STRAIT_FEET_DRY_Z], yaw: Math.PI },
};

const ZONES: Readonly<Record<string, Zone>> = {
  feetDryCorridor: {
    min: [-420, 10, -820],
    max: [420, 340, STRAIT_FEET_DRY_Z],
  },
};

const CUTSCENES: Readonly<Record<string, Cutscene>> = {
  straitOutboundIntro: {
    shots: [
      {
        from: [68, 104, 456],
        to: [34, 96, 488],
        lookFrom: [0, 92, 520],
        lookTo: [0, 94, 480],
        seconds: 3.4,
        fov: 48,
        fadeIn: 0.6,
        fadeOut: 0.4,
        caption: 'THE STRAIT // CONTRACTOR #7712-B — F-22 RAPTOR ESCORT',
      },
    ],
  },
};

export const CROSSFIRE_STRAIT: Mission = {
  id: 'crossfire_strait',
  title: 'Crossfire — The Strait',
  corpses: 16,
  loadout: PILOT_LOADOUT,
  redeployLines: CROSSFIRE_STRAIT_REDEPLOY,
  lines: CROSSFIRE_STRAIT_LINES,
  marks: MARKS,
  zones: ZONES,
  doors: {},
  routes: {},
  cutscenes: CUTSCENES,

  beats: [
    // -------------------------------------------------------------------------------------------
    // Section 1: Outbound Probe (Darrow jammed on guard, 3 Hornets over the sea stacks)
    // -------------------------------------------------------------------------------------------
    {
      id: 'outbound_probe',
      title: 'Outbound Escort — Sea Stack Probe',
      checkpoint: { at: 'outboundStart', loadout: PILOT_LOADOUT },
      start: [
        { do: 'callins', held: true },
        { do: 'threat', level: 5, grade: 'regular' },
        { do: 'music', state: 'easy' },
        { do: 'call', name: 'cf.straitOutboundInit', arg: 'outboundStart,lancerStart' },
        { do: 'cutscene', id: 'straitOutboundIntro' },
        { do: 'banner', text: 'THE STRAIT', sub: 'PART 02 OF 04 // F-22 BOMBER ESCORT' },
        say('wingman.outbound.formup'),
        { do: 'objective', id: 'escort_probe', text: 'Escort the B-1B Lancer north and splash the 3-Hornet intercept probe', at: 'lancerMid' },
        { do: 'hint', text: 'You pilot Contractor B’s F-22 Raptor! Guard the 7,500 HP AI B-1B Lancer — use AMRAAMs, gun bursts, and flares to keep bandits off her.', seconds: 8 },
        { do: 'wait', seconds: 3.5 },
        say('darrow.guard.warning', { wait: true }),
        say('council.jamming'),
        { do: 'music', state: 'hard' },
        { do: 'call', name: 'cf.straitWave', arg: 'outbound_probe' },
        say('wingman.probe.bogeys', { now: true }),
        {
          do: 'until',
          when: {
            any: [
              { signal: CROSSFIRE_SIGNALS.waveClearedOutboundProbe },
              { signal: CROSSFIRE_SIGNALS.lancerMidstrait },
            ],
          },
        },
        { do: 'done', id: 'escort_probe' },
        say('wingman.probe.clear'),
        { do: 'goto', beat: 'destroyer_gauntlet' },
      ],
    },

    // -------------------------------------------------------------------------------------------
    // Section 2: Destroyer Gauntlet (SNS Ironclad & SNS Bastion SeaRAMs + Harriers & Warthogs)
    // -------------------------------------------------------------------------------------------
    {
      id: 'destroyer_gauntlet',
      title: 'Destroyer Gauntlet',
      checkpoint: { at: 'midStraitCheck', loadout: PILOT_LOADOUT },
      start: [
        { do: 'callins', held: true },
        { do: 'threat', level: 6, grade: 'veteran' },
        { do: 'music', state: 'hard' },
        { do: 'banner', text: 'DESTROYER GAUNTLET', sub: 'SNS IRONCLAD & SNS BASTION // SEARAM SAMs ACTIVE' },
        say('halvorsen.gauntlet.fury'),
        say('halvorsen.gauntlet.fire'),
        { do: 'call', name: 'cf.straitDestroyersHot', arg: 'destroyerWest,destroyerEast' },
        { do: 'call', name: 'cf.straitWave', arg: 'destroyer_strike' },
        say('wingman.gauntlet.sams', { now: true }),
        { do: 'objective', id: 'survive_gauntlet', text: 'Shred the Harrier/Warthog strike wing and suppress the Missile Destroyers', at: 'destroyerWest' },
        { do: 'hint', text: 'Southern Missile Destroyers are firing SeaRAM SAMs and CIWS at the Lancer! Knock out their deck launchers or decoy missiles while downing the 3 Harriers & 2 Warthogs.', seconds: 9 },
        {
          do: 'until',
          when: {
            any: [
              { all: [{ signal: CROSSFIRE_SIGNALS.waveClearedDestroyerStrike }, { signal: CROSSFIRE_SIGNALS.destroyersSuppressed }] },
              { all: [{ signal: CROSSFIRE_SIGNALS.waveClearedDestroyerStrike }, { signal: CROSSFIRE_SIGNALS.lancerMidstrait }] },
              { signal: CROSSFIRE_SIGNALS.straitFeetDry },
            ],
          },
        },
        { do: 'done', id: 'survive_gauntlet' },
        say('wingman.gauntlet.suppressed'),
        { do: 'goto', beat: 'coastal_aces' },
      ],
    },

    // -------------------------------------------------------------------------------------------
    // Section 3: Coastal Aces & Feet-Dry Seat Transfer to B-1B Lancer
    // -------------------------------------------------------------------------------------------
    {
      id: 'coastal_aces',
      title: 'Coastal Aces — Feet Dry',
      checkpoint: { at: 'coastalCheck', loadout: PILOT_LOADOUT },
      start: [
        { do: 'callins', held: true },
        { do: 'threat', level: 7, grade: 'veteran' },
        { do: 'music', state: 'hard' },
        { do: 'banner', text: 'HALCYON COASTLINE', sub: 'RED-WING INTERCEPT // FEET-DRY CORRIDOR' },
        say('halvorsen.coastal.aces'),
        { do: 'call', name: 'cf.straitWave', arg: 'coastal_aces' },
        { do: 'call', name: 'cf.straitFeetDryWatch', arg: 'lancerFeetDry,halcyonCoastObj' },
        say('wingman.coastal.incoming', { now: true }),
        { do: 'objective', id: 'clear_coastal_aces', text: 'Down Halvorsen’s Raptor Ace + Hornet CAP and escort the Lancer feet-dry', at: 'halcyonCoastObj' },
        {
          do: 'until',
          when: {
            any: [
              { all: [{ signal: CROSSFIRE_SIGNALS.waveClearedCoastalAces }, { signal: CROSSFIRE_SIGNALS.straitFeetDry }] },
              { all: [{ signal: CROSSFIRE_SIGNALS.waveClearedCoastalAces }, { zone: 'feetDryCorridor' }] },
              { signal: CROSSFIRE_SIGNALS.straitFeetDry },
            ],
          },
        },
        { do: 'done', id: 'clear_coastal_aces' },
        say('wingman.coastal.feet_dry', { now: true }),
        say('council.handoff.halcyon', { wait: true }),
        { do: 'call', name: 'cf.handoffToHalcyon' },
        { do: 'wait', seconds: 2.0 },
        { do: 'finish' },
      ],
    },
  ],
};
