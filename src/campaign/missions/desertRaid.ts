/**
 * Campaign Mission 5 — "Desert Raid" (Surplus, the Saltblood shantytown).
 *
 * Strictly NO Council story or Council lines — pure desert raid against Hadrek Quist ("the Salt King").
 * Six sections with checkpoints on every beat and Thermal Vision brain chip equipped for the dark Sewer:
 *   1. approach   — Dawn 3-truck convoy rollout across open dunes under two escort gunships, bandit raiders & Quist's calm warning
 *   2. the_wall   — Slow broadside shooting gallery along the destructible sheet-metal perimeter, side-gate trucks, Warthog gate breach & dismount
 *   3. the_warren — Cut-your-own-way shantytown fight on foot beside friendly squads, optional rooftop Minigun & Quist's water bounty horde
 *   4. pump_yard  — Fortified water works, Quist drops the Water Tower to flood & block the street, dark Sewer push with Thermal Vision
 *   5. the_plane  — Solid crashed cargo plane assault against welded-armor guards, slammed bulkhead doors (auto-overridden when cleared) & Quist's 5-outcome cornered speech
 *   6. exfil      — Convoy smashes into the forecourt, mount the heavy gun for the desert chase, town-flattening airstrike ending cutscene (+ captured Quist lines)
 */
import type { Loadout, Mission, Step } from '../types';
import { LINES, REDEPLOY_LINES } from './desertRaid.lines';
import { CUTSCENES, DOORS, MARKS, ROUTES, ZONES } from './desertRaid.places';

const say = (key: string, opts: { wait?: boolean; now?: boolean; again?: boolean; within?: number } = {}): Step => ({
  do: 'say',
  line: `mission.desert_raid.${key}`,
  ...opts,
});

/** Standard raid loadout with Thermal Vision brain chip fitted for the dark Sewer section. */
const RAID_LOADOUT: Loadout = {
  weapons: ['smg', 'ultramag', 'satchel', 'knife'],
  grenades: 4,
  chip: 'thermal',
};

export const DESERT_RAID: Mission = {
  id: 'desert_raid',
  title: 'Desert Raid',
  corpses: 36,
  loadout: RAID_LOADOUT,
  redeployLines: REDEPLOY_LINES,
  lines: LINES,
  marks: MARKS,
  zones: ZONES,
  doors: DOORS,
  routes: ROUTES,
  cutscenes: CUTSCENES,

  beats: [
    // -------------------------------------------------------------------------------------------
    // Section 1: The Approach (dawn open desert)
    // -------------------------------------------------------------------------------------------
    {
      id: 'approach',
      title: 'The Approach',
      checkpoint: { at: 'approachStart', loadout: RAID_LOADOUT },
      start: [
        { do: 'callins', held: true },
        { do: 'threat', level: 3, grade: 'regular' },
        { do: 'music', state: 'easy' },
        { do: 'door', door: 'plane.door1', open: 1, seconds: 0 },
        { do: 'door', door: 'plane.door2', open: 1, seconds: 0 },
        { do: 'cutscene', id: 'opening' },
        { do: 'banner', text: 'DESERT RAID', sub: 'SURPLUS // DAWN APPROACH' },
        { do: 'call', name: 'dr.approachStart' },
        { do: 'call', name: 'dr.escortStart' },
        { do: 'squad', tag: 'lookout_w', men: ['trooper', 'trooper'], at: 'lookoutWest', orders: 'hold', ensure: true },
        { do: 'squad', tag: 'lookout_e', men: ['trooper', 'gunner'], at: 'lookoutEast', orders: 'hold', ensure: true },
        { do: 'squad', tag: 'lookout_n', men: ['trooper', 'sniper'], at: 'lookoutNorth', orders: 'hold', ensure: true },
        say('marr.approach.start'),
        { do: 'objective', id: 'approach_surplus', text: 'Ride the convoy across the dunes to Surplus', at: 'mainGateObj' },
        { do: 'hint', text: 'You man the middle truck heavy gun. Shred Saltblood lookout posts, bikes, and raiders on the dunes.', seconds: 7 },
        { do: 'until', when: { any: [{ signal: 'dr:approach_done' }, { zone: 'wallFront' }] } },
        { do: 'done', id: 'approach_surplus' },
        { do: 'goto', beat: 'the_wall' },
      ],
      cues: [
        {
          when: { after: 4 },
          run: [
            { do: 'call', name: 'dr.banditsApproach', arg: '3' },
            say('radio.approach.lookouts'),
          ],
        },
        {
          when: { after: 10 },
          run: [say('quist.approach.warn')],
        },
        {
          when: { after: 16 },
          run: [say('marr.approach.horizon')],
        },
      ],
    },

    // -------------------------------------------------------------------------------------------
    // Section 2: The Wall (broadside shooting gallery & Warthog gate breach)
    // -------------------------------------------------------------------------------------------
    {
      id: 'the_wall',
      title: 'The Wall',
      checkpoint: { at: 'wallGate', loadout: RAID_LOADOUT },
      start: [
        { do: 'callins', held: true },
        { do: 'threat', level: 4, grade: 'regular' },
        { do: 'music', state: 'hard' },
        { do: 'banner', text: 'THE WALL', sub: 'SURPLUS PERIMETER // BROADSIDE PASS' },
        { do: 'call', name: 'dr.wallLoop' },
        { do: 'call', name: 'dr.escortStart' },
        { do: 'squad', tag: 'wall_west', men: ['trooper', 'trooper', 'gunner'], at: 'wallWest', ensure: true },
        { do: 'squad', tag: 'wall_center', men: ['trooper', 'gunner', 'sniper'], at: 'wallCenter', ensure: true },
        { do: 'squad', tag: 'wall_east', men: ['trooper', 'trooper', 'gunner'], at: 'wallEast', ensure: true },
        say('marr.wall.broadside'),
        { do: 'objective', id: 'shred_wall', text: 'Tear apart the outer wall, watchtowers & Saltblood defenders', at: 'mainGateObj' },
        { do: 'hint', text: 'Rip through the sheet-metal panels, shoot men through the gaps, and drop watchtowers by their legs!', seconds: 7 },
        { do: 'until', when: { any: [{ signal: 'dr:wall_shredded' }, { cleared: ['wall_west', 'wall_center', 'wall_east'] }, { after: 22 }] } },
        { do: 'done', id: 'shred_wall' },
        say('quist.wall.gate', { wait: true }),
        say('marr.wall.warthog'),
        say('radio.wall.warthog'),
        { do: 'objective', id: 'breach_gate', text: 'Warthog gun run inbound on the Bulldozer Gate', at: 'mainGateObj' },
        { do: 'call', name: 'dr.warthogGate' },
        { do: 'until', when: { any: [{ signal: 'dr:gate_breached' }, { after: 12 }] } },
        { do: 'done', id: 'breach_gate' },
        { do: 'call', name: 'dr.dropSquads' },
        { do: 'call', name: 'dr.dismount' },
        say('marr.wall.breached', { now: true }),
        { do: 'wait', seconds: 1.5 },
        { do: 'goto', beat: 'the_warren' },
      ],
      cues: [
        {
          when: { after: 6 },
          run: [
            say('quist.wall.trucks'),
            { do: 'call', name: 'dr.sideTruckWest' },
            { do: 'call', name: 'dr.sideTruckEast' },
            say('radio.wall.sidegates'),
          ],
        },
      ],
    },

    // -------------------------------------------------------------------------------------------
    // Section 3: The Warren (cut-your-own-way shantytown on foot)
    // -------------------------------------------------------------------------------------------
    {
      id: 'the_warren',
      title: 'The Warren',
      checkpoint: { at: 'warrenMid', loadout: RAID_LOADOUT },
      start: [
        { do: 'callins', held: true },
        { do: 'threat', level: 5, grade: 'regular' },
        { do: 'music', state: 'hard' },
        { do: 'banner', text: 'THE WARREN', sub: 'SHANTYTOWN // CUT YOUR OWN WAY' },
        { do: 'call', name: 'dr.warrenStart', arg: 'warrenMinigun' },
        { do: 'drop', item: 'ammo', at: 'warrenDropAmmo' },
        { do: 'drop', item: 'health', at: 'warrenDropHealth' },
        { do: 'squad', tag: 'warren_south_w', men: ['trooper', 'trooper', 'gunner'], at: 'warrenShantyWest', ensure: true },
        { do: 'squad', tag: 'warren_south_e', men: ['trooper', 'gunner', 'riot'], at: 'warrenShantyEast', ensure: true },
        say('marr.warren.enter'),
        { do: 'objective', id: 'push_warren', text: 'Fight north through the Warren to the Pump Yard', at: 'pumpEntry' },
        { do: 'hint', text: 'Shack walls are paper — blast through buildings, leap rooftops, or grab the optional west rooftop Minigun.', seconds: 8 },
        { do: 'until', when: { any: [{ zone: 'pumpYard' }, { signal: 'dr:pump_reached' }] } },
        { do: 'done', id: 'push_warren' },
        { do: 'goto', beat: 'pump_yard' },
      ],
      cues: [
        {
          when: { zone: 'warrenSouth' },
          run: [
            { do: 'wait', seconds: 3.5 },
            say('marr.warren.minigun'),
          ],
        },
        {
          when: { any: [{ zone: 'warrenNorth' }, { cleared: ['warren_south_w', 'warren_south_e'] }] },
          run: [
            say('quist.warren.bounty', { now: true }),
            { do: 'squad', tag: 'warren_bounty_w', men: ['trooper', 'trooper', 'gunner', 'riot'], at: 'warrenBountyWest' },
            { do: 'squad', tag: 'warren_bounty_e', men: ['trooper', 'gunner', 'brute'], at: 'warrenBountyEast' },
            { do: 'squad', tag: 'warren_north_line', men: ['trooper', 'gunner', 'sniper'], at: 'warrenNorthLine' },
            say('radio.warren.squad'),
            say('marr.warren.push'),
          ],
        },
      ],
    },

    // -------------------------------------------------------------------------------------------
    // Section 4: The Pump Yard & Dark Sewer
    // -------------------------------------------------------------------------------------------
    {
      id: 'pump_yard',
      title: 'The Pump Yard',
      checkpoint: { at: 'pumpEntry', loadout: RAID_LOADOUT },
      start: [
        { do: 'callins', held: true },
        { do: 'call', name: 'chip', arg: 'thermal' },
        { do: 'threat', level: 6, grade: 'veteran' },
        { do: 'music', state: 'hard' },
        { do: 'banner', text: 'THE PUMP YARD', sub: 'SURPLUS WATER WORKS' },
        { do: 'sweep', tag: 'wall_west' },
        { do: 'sweep', tag: 'wall_center' },
        { do: 'sweep', tag: 'wall_east' },
        { do: 'call', name: 'dr.pumpStart' },
        { do: 'drop', item: 'ammo', at: 'pumpDropAmmo' },
        { do: 'drop', item: 'health', at: 'sewerDropHealth' },
        { do: 'squad', tag: 'pump_west', men: ['trooper', 'gunner', 'warden'], at: 'pumpWest', ensure: true },
        { do: 'squad', tag: 'pump_east', men: ['trooper', 'riot', 'sniper'], at: 'pumpEast', ensure: true },
        say('marr.pump.enter'),
        { do: 'objective', id: 'cross_pump', text: 'Cross the Pump Yard toward the Crashed Plane', at: 'waterTowerObj' },
        { do: 'until', when: { any: [{ signal: 'dr:tower_dropped' }, { zone: 'sewer' }, { zone: 'planeForecourt' }] } },
        { do: 'done', id: 'cross_pump' },
        say('quist.pump.tower', { now: true }),
        { do: 'wait', seconds: 1.6 },
        say('marr.pump.sewer'),
        { do: 'hint', text: 'Press [T] for your Thermal Vision brain chip to spot Saltblood ambushers waiting in the dark storm sewer!', seconds: 9 },
        { do: 'objective', id: 'enter_sewer', text: 'Drop into the west storm sewer and push under the plane', at: 'sewerGrate' },
        { do: 'squad', tag: 'sewer_ambush_1', men: ['trooper', 'gunner', 'riot'], at: 'sewerMid', orders: 'ambush', ensure: true },
        { do: 'squad', tag: 'sewer_ambush_2', men: ['trooper', 'warden'], at: 'sewerNorth', orders: 'ambush', ensure: true },
        { do: 'until', when: { any: [{ zone: 'planeForecourt' }, { signal: 'dr:sewer_cleared' }] } },
        { do: 'done', id: 'enter_sewer' },
        { do: 'goto', beat: 'the_plane' },
      ],
      cues: [
        {
          when: { zone: 'sewer' },
          run: [
            { do: 'music', state: 'easy' },
            { do: 'objective', id: 'exit_sewer', text: 'Climb the north sewer ladder into the Plane forecourt', at: 'sewerExit' },
            say('quist.sewer.dark.1'),
            { do: 'wait', seconds: 5 },
            say('quist.sewer.dark.2'),
            say('marr.sewer.exit'),
          ],
        },
      ],
    },

    // -------------------------------------------------------------------------------------------
    // Section 5: The Plane (solid hull, bulkhead locks & Quist 5-outcome finale)
    // -------------------------------------------------------------------------------------------
    {
      id: 'the_plane',
      title: 'The Plane',
      checkpoint: { at: 'planeEntry', loadout: RAID_LOADOUT },
      start: [
        { do: 'callins', held: true },
        { do: 'call', name: 'chip', arg: 'thermal' },
        { do: 'done', id: 'exit_sewer' },
        { do: 'sweep', tag: 'pump_west' },
        { do: 'sweep', tag: 'pump_east' },
        { do: 'threat', level: 7, grade: 'veteran' },
        { do: 'music', state: 'hard' },
        { do: 'banner', text: 'THE PLANE', sub: 'HADREK QUIST // CRASHED FUSELAGE' },
        { do: 'door', door: 'plane.door1', open: 1, seconds: 0 },
        { do: 'door', door: 'plane.door2', open: 1, seconds: 0 },
        { do: 'drop', item: 'ammo', at: 'planeDropAmmo' },
        { do: 'drop', item: 'health', at: 'planeDropHealth' },
        { do: 'squad', tag: 'plane_forecourt', men: ['warden', 'gunner'], at: 'planeForecourtGuard', ensure: true },
        { do: 'squad', tag: 'plane_guards_1', men: ['warden', 'riot', 'gunner'], at: 'planeComp1', orders: 'hold', ensure: true },
        { do: 'squad', tag: 'plane_guards_2', men: ['brute', 'warden', 'gunner'], at: 'planeComp2', orders: 'hold', ensure: true },
        { do: 'call', name: 'dr.planeStart' },
        say('marr.plane.enter'),
        { do: 'objective', id: 'corner_quist', text: 'Storm the Cargo Plane and corner Hadrek Quist at the tail', at: 'quistTail' },
        { do: 'until', when: { signal: 'dr:quist_done' } },
        { do: 'done', id: 'corner_quist' },
        { do: 'wait', seconds: 2.6 },
        { do: 'goto', beat: 'exfil' },
      ],
      cues: [
        {
          when: { signal: 'dr:door1_slam' },
          run: [
            { do: 'door', door: 'plane.door1', open: 0, seconds: 0.55 },
            { do: 'release', tag: 'plane_guards_1' },
            say('quist.door1', { now: true }),
            say('marr.door1.locked'),
          ],
        },
        {
          when: { all: [{ signal: 'dr:door1_slam' }, { any: [{ cleared: 'plane_guards_1' }, { signal: 'dr:door1_open' }] }] },
          run: [
            { do: 'wait', seconds: 0.8 },
            { do: 'door', door: 'plane.door1', open: 1, seconds: 1.0 },
            say('marr.door1.open'),
          ],
        },
        {
          when: { zone: 'planeMid' },
          run: [
            { do: 'release', tag: 'plane_guards_2' },
            { do: 'call', name: 'dr.planeAdvanceTail' },
          ],
        },
        {
          when: { signal: 'dr:door2_slam' },
          run: [
            { do: 'door', door: 'plane.door2', open: 0, seconds: 0.55 },
            { do: 'release', tag: 'plane_guards_2' },
            say('quist.door2', { now: true }),
            say('marr.door2.locked'),
          ],
        },
        {
          when: { all: [{ signal: 'dr:door2_slam' }, { any: [{ cleared: 'plane_guards_2' }, { signal: 'dr:door2_open' }] }] },
          run: [
            { do: 'wait', seconds: 0.8 },
            { do: 'door', door: 'plane.door2', open: 1, seconds: 1.0 },
            say('marr.door2.open'),
          ],
        },
        {
          when: { zone: 'planeTail' },
          run: [
            { do: 'music', state: 'menu' },
            { do: 'hint', text: 'Quist is cornered: Hold {interact} to capture him, tap {interact} to talk, shoot him, or let him finish.', seconds: 10 },
          ],
        },
        {
          when: { signal: 'dr:quist_captured' },
          run: [say('marr.quist.captured')],
        },
        {
          when: { signal: 'dr:quist_killed' },
          run: [say('marr.quist.killed', { now: true })],
        },
        {
          when: { signal: 'dr:quist_suicide' },
          run: [say('marr.quist.suicide')],
        },
        {
          when: { signal: 'dr:quist_grenade_survived' },
          run: [say('marr.quist.grenade')],
        },
      ],
    },

    // -------------------------------------------------------------------------------------------
    // Section 6: Exfil & Town-Flattening Ending Cutscene
    // -------------------------------------------------------------------------------------------
    {
      id: 'exfil',
      title: 'Exfil',
      checkpoint: { at: 'exfilPickup', loadout: RAID_LOADOUT },
      start: [
        { do: 'callins', held: true },
        { do: 'sweep' },
        { do: 'music', state: 'hard' },
        { do: 'banner', text: 'EXFIL', sub: 'CONVOY BREAKOUT // SURPLUS' },
        { do: 'call', name: 'dr.exfilArrive' },
        say('radio.exfil.arrive', { now: true }),
        say('marr.exfil.board'),
        { do: 'objective', id: 'board_convoy', text: 'Board the middle convoy truck in the forecourt', at: 'exfilPickup' },
        { do: 'hint', text: 'Press {interact} at the middle convoy truck to mount the heavy gun and break out!', seconds: 8 },
        { do: 'until', when: { signal: 'dr:exfil_boarded' } },
        { do: 'done', id: 'board_convoy' },
        { do: 'call', name: 'dr.exfilChase' },
        say('radio.exfil.chase', { now: true }),
        { do: 'objective', id: 'escape_surplus', text: 'Fight off pursuing Saltbloods until clear of Surplus' },
        { do: 'until', when: { signal: 'dr:exfil_clear' } },
        { do: 'done', id: 'escape_surplus' },
        say('marr.exfil.airstrike', { now: true }),
        say('radio.exfil.strikes'),
        { do: 'call', name: 'dr.endingCutscene' },
        { do: 'until', when: { any: [{ signal: 'dr:ending_done' }, { after: 20 }] } },
        { do: 'wait', seconds: 0.25 },
        { do: 'finish' },
      ],
      cues: [
        {
          when: { signal: 'dr:ending_quist_captured' },
          run: [
            say('quist.ending.1'),
            say('quist.ending.2'),
            say('quist.ending.3'),
          ],
        },
      ],
    },
  ],
};
