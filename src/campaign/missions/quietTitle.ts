/**
 * Mission 3: "Quiet Title" — Stealth / Sandbox Assassination at the Chancery Estate.
 *
 * Open-ended 4-beat structure:
 *   1. `briefing`     — 3-shot moonlit flyover + Council Form 7742-X & Diplomatic Arbitration Charter briefing.
 *   2. `infiltration` — Full sandbox estate infiltration. Ghost Sniper (Bell-Tower AWL .50) or Silent CQB
 *                       assassination kills Vane and jumps straight to `exfil`, skipping `lockdown` completely.
 *   3. `lockdown`     — Compound Lockdown & Subterranean Continuity Bunker Breach via EITHER Armory Breach Charges
 *                       OR Generator Sub-Basement Hydraulic Overload. Security Hub override stops QRF waves.
 *   4. `exfil`        — Target eliminated, Form 9-A voided, extract via Coastal Culvert or North Cliff Line.
 */
import type { EnemyId } from '../../core/gameplay';
import type { Beat, Loadout, Mission, Step } from '../types';
import { QUIET_TITLE_LINES, REDEPLOY_LINES } from './quietTitle.lines';
import { CUTSCENES, DOORS, MARKS, ROUTES, ZONES } from './quietTitle.places';

const say = (id: string, wait = false, now = false): Step => ({
  do: 'say',
  line: `mission.quiet_title.${id}`,
  wait,
  ...(now ? { now: true } : {}),
});
const council = (id: string, wait = false): Step => say(`council.${id}`, wait);
const vane = (id: string, wait = false, now = false): Step => say(`vane.${id}`, wait, now);
const guard = (id: string, wait = false): Step => say(`guard.${id}`, wait);

/** Forced stealth starting loadout: suppressed Ultramag + short suppressed Gimlet + knife, Thermal chip, no grenades. */
export const KIT = {
  stealth: {
    weapons: ['ultramag', 'gimlet', 'knife'],
    grenades: 0,
    exclusiveMods: true,
    mods: ['ultramagCan', 'ultramagAp', 'gimletShort', 'gimletDot', 'gimletCan'],
    chip: 'thermal',
  },
} as const satisfies Record<string, Loadout>;

const posted = (tag: string, men: readonly EnemyId[], at: string): Step => ({
  do: 'squad',
  tag,
  men,
  at,
  orders: 'hold',
  ensure: true,
});

const BELL_PERCH_RACK: Step = {
  do: 'rack',
  weapon: 'awl',
  at: 'bellPerch',
  optional: true,
  mods: ['awl50', 'awlCan', 'awlAp', 'awlBarrel'],
  label: 'AWL .50 SUPPRESSED',
};

const ARMORY_BREACH_RACK: Step = {
  do: 'rack',
  weapon: 'satchel',
  at: 'armoryRack',
  optional: true,
  label: 'BREACH CHARGES',
};

const BEATS: readonly Beat[] = [
  {
    id: 'briefing',
    title: 'Form 7742-X: Quiet Title',
    start: [
      { do: 'music', state: 'menu' },
      { do: 'callins', held: true },
      council('brief.form'),
      council('brief.charter'),
      council('brief.gear'),
      council('brief.target'),
      { do: 'cutscene', id: 'briefing' },
      { do: 'signal', name: 'briefed' },
    ],
    until: { signal: 'briefed' },
  },
  {
    id: 'infiltration',
    title: 'The Chancery Estate',
    checkpoint: { at: 'culvert', loadout: KIT.stealth },
    start: [
      { do: 'music', state: 'easy' },
      { do: 'threat', level: 2 },
      { do: 'callins', held: true },
      { do: 'door', door: 'shutter.south', open: 1, seconds: 0 },
      { do: 'door', door: 'shutter.east', open: 1, seconds: 0 },
      { do: 'objective', id: 'vane', text: 'Eliminate High Magistrate Aldous Vane before 06:00', at: 'vaneDesk' },
      {
        do: 'hint',
        text: 'Tap [T] for Thermal Vision. Shoot out lights or flip circuit breakers, sneak behind guards to press {interact} for silent takedowns, or climb the East Bell Tower.',
        seconds: 11,
      },
      // Estate security patrols (total 13 guards + Vane = 14 <= MAX_HOSTILE 18)
      posted('patrol.west', ['trooper', 'trooper'], 'westGarden'),
      posted('patrol.gen', ['trooper', 'trooper'], 'generatorHouse'),
      posted('patrol.courtyard', ['trooper', 'gunner'], 'courtyard'),
      posted('patrol.east', ['trooper', 'trooper'], 'eastTerrace'),
      posted('patrol.mansion', ['trooper', 'trooper'], 'foyer'),
      posted('guard.archive', ['warden'], 'eastArchive'),
      posted('guard.upper', ['trooper', 'trooper'], 'vaneWindow'),
      // Director setup: assigns patrol routes, spawns Vane in Upper Bureau, activates stealth & security systems
      { do: 'call', name: 'qt.setup', arg: 'lift,generatorConsole' },
      // Contractor #4418-B's fully modded .50 suppressed AWL on the East Bell-Tower Sniper Perch
      BELL_PERCH_RACK,
      // Shaped Breach Charges / Satchels in the Sub-Level Estate Guard Armory
      ARMORY_BREACH_RACK,
    ],
    cues: [
      { when: { after: 10 }, run: [vane('ambient.holdfast')] },
      { when: { after: 28 }, run: [guard('patrol.murmur')] },
      { when: { after: 45 }, run: [vane('ambient.lights')] },
      { when: { after: 72 }, run: [vane('ambient.goggles')] },
      {
        when: { any: [{ zone: 'bellTower' }, { signal: 'took:awl' }] },
        run: [council('perch.4418')],
      },
      { when: { signal: 'qt:light_broken' }, run: [guard('dark.helmet')] },
      { when: { signal: 'qt:breaker_tripped' }, run: [vane('lights.out'), guard('breaker.check')] },
      { when: { signal: 'qt:hub_overridden' }, run: [council('hub.overridden')] },
      // Ghost Sniper or Silent CQB assassination payoff: skip lockdown straight to exfil!
      {
        when: { signal: 'qt:vane_dead' },
        run: [
          { do: 'done', id: 'vane' },
          { do: 'goto', beat: 'exfil' },
        ],
      },
      // Compound Lockdown: slam Upper Bureau blast shutters and move to Continuity Bunker breach
      {
        when: { signal: 'qt:lockdown' },
        run: [
          { do: 'door', door: 'shutter.south', open: 0, seconds: 1.4 },
          { do: 'door', door: 'shutter.east', open: 0, seconds: 1.2 },
          vane('lockdown.retreat', false, true),
          { do: 'goto', beat: 'lockdown' },
        ],
      },
    ],
    until: { any: [{ signal: 'qt:vane_dead' }, { signal: 'qt:lockdown' }] },
  },
  {
    id: 'lockdown',
    title: 'Continuity Protocol',
    checkpoint: { at: 'courtyardRally', loadout: KIT.stealth },
    start: [
      { do: 'music', state: 'hard' },
      { do: 'threat', level: 3 },
      { do: 'callins', held: true },
      { do: 'door', door: 'shutter.south', open: 0, seconds: 0 },
      { do: 'door', door: 'shutter.east', open: 0, seconds: 0 },
      BELL_PERCH_RACK,
      ARMORY_BREACH_RACK,
      { do: 'call', name: 'qt.lockdown', arg: 'bunkerDoor,bunkerDesk,generatorConsole,armoryRack' },
      { do: 'done', id: 'vane' },
      {
        do: 'objective',
        id: 'breach',
        text: 'Breach the Continuity Bunker (Armory Charges or Generator Overload)',
        at: 'bunkerDoor',
      },
      { do: 'objective', id: 'vaneBunker', text: 'Eliminate High Magistrate Vane', at: 'bunkerDesk' },
      council('lockdown.notice'),
      council('lockdown.breach'),
      {
        do: 'hint',
        text: 'Crack the Tier-3 Blast Door with Armory Breach Charges OR overload the Generator Sub-Basement capacitor. Override the Security Hub in East Archive to stop QRF waves.',
        seconds: 11,
      },
      posted('bunker.antechamber', ['riot', 'trooper', 'gunner'], 'vaultAntechamber'),
      posted('bunker.detail', ['warden', 'trooper', 'trooper'], 'bunkerDesk'),
      { do: 'squad', tag: 'qrf.wave', men: ['trooper', 'gunner', 'trooper'], at: 'gatehouse', ensure: true },
    ],
    cues: [
      { when: { after: 14 }, run: [vane('lockdown.taunt')] },
      { when: { signal: 'qt:hub_overridden' }, run: [council('hub.overridden')] },
      { when: { signal: 'qt:breach_planted' }, run: [vane('breach.charge', false, true)] },
      { when: { signal: 'qt:overload_started' }, run: [vane('overload.panic', false, true)] },
      {
        when: { signal: 'qt:bunker_breached' },
        run: [
          { do: 'done', id: 'breach' },
          council('bunker.breached'),
          vane('bunker.breached', false, true),
          { do: 'release', tag: 'bunker.detail' },
        ],
      },
    ],
    until: { signal: 'qt:vane_dead' },
  },
  {
    id: 'exfil',
    title: 'Clean Exit',
    checkpoint: { at: 'courtyardRally', loadout: KIT.stealth },
    start: [
      { do: 'done', id: 'vane' },
      { do: 'done', id: 'breach' },
      { do: 'done', id: 'vaneBunker' },
      { do: 'music', state: 'easy' },
      { do: 'callins', held: true },
      { do: 'call', name: 'qt.exfil' },
      council('vane.dead'),
      council('exfil.order'),
      { do: 'objective', id: 'exfil', text: 'Extract via Coastal Culvert or North Cliff Line', at: 'culvert' },
      {
        do: 'hint',
        text: 'Return to the Coastal Culvert (south-west) or reach the North Cliff Extraction Point behind the estate.',
        seconds: 10,
      },
    ],
    cues: [
      {
        when: { any: [{ zone: 'exfilCulvert' }, { zone: 'exfilCliff' }] },
        run: [
          { do: 'done', id: 'exfil' },
          council('exfil.done', true),
          { do: 'finish' },
        ],
      },
    ],
  },
];

export const QUIET_TITLE: Mission = {
  id: 'quiet_title',
  title: 'Quiet Title',
  stealth: true,
  loadout: KIT.stealth,
  zones: ZONES,
  marks: MARKS,
  routes: ROUTES,
  doors: DOORS,
  cutscenes: CUTSCENES,
  lines: QUIET_TITLE_LINES,
  redeployLines: REDEPLOY_LINES,
  corpses: 12,
  beats: BEATS,
};
