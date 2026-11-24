/**
 * Crossfire Part 4 — "Dusk Egress" (`map: 'strait'`, Contractor #7712-B, ~3–4 min cinematic finale).
 *
 * Contractor B flies the F-22 Raptor defending the smoking, ordnance-spent B-1B Lancer on its
 * desperate sprint south across the dusk strait into the friendly CVN-91 Carrier Strike Group umbrella:
 *   1. ambush           — Halvorsen's surviving Red-Wing Ace Squadron (2 Ace Raptors + 4 Hornets) dives from the dusk clouds
 *   2. carrier_umbrella — Final dogfight as the wounded Lancer crosses `STRAIT_CARRIER_RECOVERY_Z` into friendly carrier CIWS cover
 *   3. debrief          — Deadpan Council wrap-up: full-scale North/South war erupted, 42% cost reduction logged, 38-ton munitions invoice issued
 */
import {
  STRAIT_CARRIER_CENTER,
  STRAIT_CARRIER_RECOVERY_Z,
  STRAIT_INBOUND_LANCER_PATH,
  STRAIT_INBOUND_PLAYER_SPAWN,
} from '../../world/map/strait/plan';
import { CROSSFIRE_SIGNALS } from '../crossfire/chain';
import type { Cutscene, Loadout, Mark, Mission, Step, Zone } from '../types';
import { CROSSFIRE_RETURN_LINES, CROSSFIRE_RETURN_REDEPLOY } from './crossfire.lines';

const say = (key: string, opts: { wait?: boolean; now?: boolean; again?: boolean; within?: number } = {}): Step => ({
  do: 'say',
  line: `mission.crossfire.return.${key}`,
  ...opts,
});

const PILOT_LOADOUT: Loadout = {
  weapons: ['smg', 'ultramag', 'knife'],
  grenades: 2,
};

const MARKS: Readonly<Record<string, Mark>> = {
  returnStart: { at: STRAIT_INBOUND_PLAYER_SPAWN.at, yaw: STRAIT_INBOUND_PLAYER_SPAWN.yaw },
  carrierApproachCheck: { at: [-24, 92, 160], yaw: 0 },
  lancerReturnStart: { at: STRAIT_INBOUND_LANCER_PATH[0]!, yaw: 0 },
  lancerReturnMid: { at: STRAIT_INBOUND_LANCER_PATH[2]!, yaw: 0 },
  carrierRecoveryObj: { at: [STRAIT_CARRIER_CENTER[0], 68, STRAIT_CARRIER_RECOVERY_Z], yaw: 0 },
  carrierCenter: { at: STRAIT_CARRIER_CENTER, yaw: 0 },
};

const ZONES: Readonly<Record<string, Zone>> = {
  carrierUmbrellaZone: {
    min: [-420, 10, STRAIT_CARRIER_RECOVERY_Z],
    max: [420, 340, 820],
  },
};

const CUTSCENES: Readonly<Record<string, Cutscene>> = {
  duskReturnIntro: {
    shots: [
      {
        from: [58, 126, -545],
        to: [-36, 118, -582],
        lookFrom: [0, 118, -610],
        lookTo: [0, 112, -520],
        seconds: 3.4,
        fov: 48,
        fadeIn: 0.6,
        fadeOut: 0.4,
        caption: 'THE STRAIT // DUSK EGRESS — WOUNDED LANCER ESCORT',
      },
    ],
  },
  carrierDebriefFlyby: {
    shots: [
      {
        from: [-95, 52, 410],
        to: [120, 74, 620],
        lookFrom: [0, 62, 490],
        lookTo: [0, 26, 540],
        seconds: 5.0,
        fov: 46,
        fadeIn: 0.5,
        fadeOut: 1.0,
        caption: 'CVN-91 CARRIER STRIKE GROUP // FORM 7742-W CLOSED',
      },
    ],
    endsBlack: true,
  },
};

export const CROSSFIRE_RETURN: Mission = {
  id: 'crossfire_return',
  title: 'Crossfire — Dusk Egress',
  corpses: 16,
  loadout: PILOT_LOADOUT,
  redeployLines: CROSSFIRE_RETURN_REDEPLOY,
  lines: CROSSFIRE_RETURN_LINES,
  marks: MARKS,
  zones: ZONES,
  doors: {},
  routes: {},
  cutscenes: CUTSCENES,

  beats: [
    // -------------------------------------------------------------------------------------------
    // Section 1: Red-Wing Dusk Ambush (2 Ace Raptors + 4 Hornets)
    // -------------------------------------------------------------------------------------------
    {
      id: 'ambush',
      title: 'Red-Wing Dusk Ambush',
      checkpoint: { at: 'returnStart', loadout: PILOT_LOADOUT },
      start: [
        { do: 'callins', held: true },
        { do: 'threat', level: 7, grade: 'veteran' },
        { do: 'music', state: 'hard' },
        { do: 'call', name: 'cf.straitReturnInit', arg: 'returnStart,lancerReturnStart' },
        { do: 'cutscene', id: 'duskReturnIntro' },
        { do: 'banner', text: 'DUSK EGRESS', sub: 'PART 04 OF 04 // DEFEND THE WOUNDED LANCER' },
        { do: 'call', name: 'cf.straitWave', arg: 'return_ambush' },
        say('wingman.ambush.start', { now: true }),
        say('wingman.ambush.lancer'),
        { do: 'objective', id: 'break_ambush', text: 'Defend the smoking B-1B Lancer from Red-Wing Squadron (2 Ace Raptors + 4 Hornets)', at: 'lancerReturnMid' },
        { do: 'hint', text: 'Halvorsen’s surviving Red-Wing Aces are diving straight at the wounded bomber! Prioritize the Ace Raptors before they finish the Lancer!', seconds: 8 },
        {
          do: 'until',
          when: {
            any: [
              { signal: CROSSFIRE_SIGNALS.waveClearedReturnAmbush },
              { signal: CROSSFIRE_SIGNALS.lancerRecovered },
            ],
          },
        },
        { do: 'done', id: 'break_ambush' },
        say('wingman.ambush.broken'),
        { do: 'goto', beat: 'carrier_umbrella' },
      ],
    },

    // -------------------------------------------------------------------------------------------
    // Section 2: Carrier Recovery Umbrella (CVN-91 & Escort Frigates CIWS/SAM Cover)
    // -------------------------------------------------------------------------------------------
    {
      id: 'carrier_umbrella',
      title: 'Carrier Umbrella',
      checkpoint: { at: 'carrierApproachCheck', loadout: PILOT_LOADOUT },
      start: [
        { do: 'callins', held: true },
        { do: 'threat', level: 8, grade: 'veteran' },
        { do: 'music', state: 'hard' },
        { do: 'banner', text: 'CARRIER UMBRELLA', sub: 'CVN-91 RECOVERY LINE // FINAL INTERCEPT' },
        { do: 'call', name: 'cf.straitCarrierUmbrella', arg: 'carrierRecoveryObj,carrierCenter' },
        { do: 'call', name: 'cf.straitWave', arg: 'return_final' },
        say('wingman.carrier.approach'),
        { do: 'objective', id: 'reach_umbrella', text: 'Escort the B-1B Lancer south across the CVN-91 recovery line', at: 'carrierRecoveryObj' },
        {
          do: 'until',
          when: {
            any: [
              { signal: CROSSFIRE_SIGNALS.lancerRecovered },
              { all: [{ signal: CROSSFIRE_SIGNALS.waveClearedReturnFinal }, { zone: 'carrierUmbrellaZone' }] },
            ],
          },
        },
        { do: 'done', id: 'reach_umbrella' },
        say('wingman.carrier.safe', { now: true }),
        { do: 'goto', beat: 'debrief' },
      ],
      cues: [
        {
          when: { zone: 'carrierUmbrellaZone' },
          run: [say('wingman.carrier.umbrella_hot')],
        },
      ],
    },

    // -------------------------------------------------------------------------------------------
    // Section 3: Deadpan Council Debrief & Mission Complete
    // -------------------------------------------------------------------------------------------
    {
      id: 'debrief',
      title: 'Form 7742-W Closed',
      start: [
        { do: 'callins', held: true },
        { do: 'music', state: 'menu' },
        { do: 'banner', text: 'FORM 7742-W COMPLETE', sub: 'CROSS-BORDER LIABILITY TRANSFER // APPROVED' },
        { do: 'call', name: 'cf.crossfireDebrief' },
        say('council.debrief.1', { wait: true }),
        say('council.debrief.2', { wait: true }),
        say('council.debrief.3', { wait: true }),
        { do: 'cutscene', id: 'carrierDebriefFlyby' },
        { do: 'finish' },
      ],
    },
  ],
};
