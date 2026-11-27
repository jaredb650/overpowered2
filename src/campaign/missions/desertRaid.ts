/**
 * Campaign Mission 5 — "Desert Raid" (Surplus, the Saltblood shantytown).
 *
 * Strictly NO Council story or Council lines — pure gritty Saltblood raid led by Sergeant Marr
 * against Hadrek Quist ("the Salt King").
 *
 * Eight full sections with checkpoints on every beat and Thermal Vision brain chip equipped:
 *   1. approach      — Dawn 3-truck convoy rollout on the Mk 19 40mm grenade launcher, 4 manned lookout posts & 2 bandit bike/technical packs
 *   2. the_wall      — Slow broadside shooting gallery along the sturdier scrap wall, 16 elevated defenders on battlements & watchtowers, side-gate trucks, Warthog breach & dismount
 *   3. the_warren    — Multi-stage cut-your-own-way shantytown fight on foot (Wave 1 + Quist water-bounty Wave 2 horde) & optional rooftop Minigun
 *   4. pump_yard     — Fortified Pump Yard, Quist drops the 18.5 m Water Tower to flood & seal the street, 50 m dark Storm Sewer push with Thermal Vision & 3 ambush squads
 *   5. high_terraces — 3-tier vertical village ("The Perches") with watchtowers, stilted canvas tents & 21 enemies across y = 0 / 3.6 / 7.2
 *   6. salt_cave     — Subterranean sandstone cistern tunnels (y = -2.5) with timber mine-shoring & 14 cave elites
 *   7. the_plane     — Relocated northern Plane Canyon hull, 16 welded-armor guards, slammed bulkhead locks & Quist's goreable 5-outcome tail finale
 *   8. exfil         — Forecourt convoy arrival, live cuffed Quist escort (with stragglers & crush/shot handling), eastern canyon bypass chase & town-flattening ending cutscene
 */
import type { Loadout, Mission, Step } from '../types';
import { LINES, REDEPLOY_LINES } from './desertRaid.lines';
import { CUTSCENES, DOORS, MARKS, ROUTES, ZONES } from './desertRaid.places';

const say = (key: string, opts: { wait?: boolean; now?: boolean; again?: boolean; within?: number } = {}): Step => ({
  do: 'say',
  line: `mission.desert_raid.${key}`,
  ...opts,
});

/** Standard raid loadout with Thermal Vision brain chip fitted for the dark Sewer & Salt Cave. */
const RAID_LOADOUT: Loadout = {
  weapons: ['smg', 'ultramag', 'satchel', 'knife'],
  grenades: 4,
  chip: 'thermal',
};

export const DESERT_RAID: Mission = {
  id: 'desert_raid',
  title: 'Desert Raid',
  corpses: 44,
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
    // Section 1: The Approach (dawn open desert on the Mk 19 40mm belt-fed grenade launcher)
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
        // 4 manned lookout posts across the dawn dunes (10 human lookouts total)
        { do: 'squad', tag: 'lookout_1', men: ['trooper', 'trooper', 'gunner'], at: 'lookoutPost1', orders: 'hold', ensure: true },
        { do: 'squad', tag: 'lookout_2', men: ['trooper', 'sniper'], at: 'lookoutPost2', orders: 'hold', ensure: true },
        { do: 'squad', tag: 'lookout_3', men: ['trooper', 'gunner', 'sniper'], at: 'lookoutPost3', orders: 'hold', ensure: true },
        { do: 'squad', tag: 'lookout_4', men: ['trooper', 'gunner'], at: 'lookoutPost4', orders: 'hold', ensure: true },
        say('marr.approach.start'),
        { do: 'objective', id: 'approach_surplus', text: 'Ride the convoy across the dunes to Surplus', at: 'mainGateObj' },
        { do: 'hint', text: 'You man the Jackal technical turret — LMB .50-cal HMG, RMB 40mm grenade launcher. Shred Saltblood lookouts, motos, quads, and technicals!', seconds: 8 },
        { do: 'until', when: { any: [{ signal: 'dr:approach_done' }, { zone: 'wallFront' }] } },
        { do: 'done', id: 'approach_surplus' },
        { do: 'goto', beat: 'the_wall' },
      ],
      cues: [
        {
          when: { after: 2.5 },
          run: [
            { do: 'call', name: 'dr.banditsApproach', arg: '4' },
            say('radio.approach.lookouts'),
          ],
        },
        {
          when: { after: 8.5 },
          run: [
            { do: 'call', name: 'dr.banditsApproach', arg: '5' },
            say('radio.approach.bikes'),
          ],
        },
        {
          when: { after: 12 },
          run: [say('quist.approach.warn')],
        },
        {
          when: { after: 18 },
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
        { do: 'sweep', tag: 'lookout_1' },
        { do: 'sweep', tag: 'lookout_2' },
        { do: 'sweep', tag: 'lookout_3' },
        { do: 'sweep', tag: 'lookout_4' },
        { do: 'banner', text: 'THE WALL', sub: 'SURPLUS PERIMETER // BROADSIDE PASS' },
        { do: 'call', name: 'dr.wallLoop' },
        { do: 'call', name: 'dr.escortStart' },
        // 16 visible Saltblood defenders across elevated wall battlements (y = 3.6) and watchtowers
        { do: 'squad', tag: 'wall_west_top', men: ['trooper', 'trooper', 'gunner'], at: 'wallWestTop', orders: 'hold', ensure: true },
        { do: 'squad', tag: 'wall_center_top', men: ['trooper', 'gunner', 'sniper', 'trooper'], at: 'wallCenterTop', orders: 'hold', ensure: true },
        { do: 'squad', tag: 'wall_east_top', men: ['trooper', 'trooper', 'gunner'], at: 'wallEastTop', orders: 'hold', ensure: true },
        { do: 'squad', tag: 'wall_towers_w', men: ['sniper', 'trooper', 'gunner'], at: 'wallTowersWest', orders: 'hold', ensure: true },
        { do: 'squad', tag: 'wall_towers_e', men: ['sniper', 'trooper', 'gunner'], at: 'wallTowersEast', orders: 'hold', ensure: true },
        say('marr.wall.broadside'),
        { do: 'objective', id: 'shred_wall', text: 'Tear apart the outer wall, watchtowers & Saltblood defenders', at: 'mainGateObj' },
        { do: 'hint', text: 'Hammer the scrap wall with LMB .50-cal HMG and RMB 40mm grenades — blast holes through panels, drop watchtowers by their legs, and clear the battlements!', seconds: 8 },
        {
          do: 'until',
          when: {
            any: [
              { signal: 'dr:wall_shredded' },
              { cleared: ['wall_west_top', 'wall_center_top', 'wall_east_top', 'wall_towers_w', 'wall_towers_e'] },
              { after: 30 },
            ],
          },
        },
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
          when: { after: 5 },
          run: [
            say('quist.wall.trucks'),
            { do: 'call', name: 'dr.sideTruckWest' },
            say('radio.wall.sidegates'),
          ],
        },
        {
          when: { after: 11 },
          run: [
            { do: 'call', name: 'dr.sideTruckEast' },
          ],
        },
      ],
    },

    // -------------------------------------------------------------------------------------------
    // Section 3: The Warren (multi-stage cut-your-own-way shantytown on foot)
    // -------------------------------------------------------------------------------------------
    {
      id: 'the_warren',
      title: 'The Warren',
      checkpoint: { at: 'warrenStart', loadout: RAID_LOADOUT },
      start: [
        { do: 'callins', held: true },
        { do: 'threat', level: 5, grade: 'regular' },
        { do: 'music', state: 'hard' },
        { do: 'sweep', tag: 'wall_west_top' },
        { do: 'sweep', tag: 'wall_center_top' },
        { do: 'sweep', tag: 'wall_east_top' },
        { do: 'sweep', tag: 'wall_towers_w' },
        { do: 'sweep', tag: 'wall_towers_e' },
        { do: 'banner', text: 'THE WARREN', sub: 'SHANTYTOWN // CUT YOUR OWN WAY' },
        { do: 'call', name: 'dr.warrenStart', arg: 'warrenMinigun' },
        { do: 'drop', item: 'ammo', at: 'warrenDropAmmo' },
        { do: 'drop', item: 'health', at: 'warrenDropHealth' },
        // Wave 1 (South/Mid Warren): 12 Saltblood raiders across shacks, alleys, and roofs
        { do: 'squad', tag: 'warren_south', men: ['trooper', 'trooper', 'gunner', 'riot'], at: 'warrenSouthPost', ensure: true },
        { do: 'squad', tag: 'warren_west_roof', men: ['trooper', 'gunner', 'sniper', 'trooper'], at: 'warrenWestRoof', orders: 'hold', ensure: true },
        { do: 'squad', tag: 'warren_east_alley', men: ['trooper', 'gunner', 'trooper', 'riot'], at: 'warrenEastAlley', ensure: true },
        say('marr.warren.enter'),
        { do: 'objective', id: 'push_warren', text: 'Fight north through the Warren to the Pump Yard', at: 'pumpEntry' },
        { do: 'hint', text: 'Shack walls splinter under fire — blast through buildings, leap rooftops, or man the optional west rooftop Minigun.', seconds: 8 },
        {
          do: 'until',
          when: {
            any: [
              { all: [{ zone: 'pumpApproach' }, { kills: 6 }] },
              { cleared: ['warren_south', 'warren_west_roof', 'warren_east_alley', 'warren_bounty_w', 'warren_bounty_e', 'warren_bounty_n'] },
              { signal: 'dr:pump_reached' },
            ],
          },
        },
        { do: 'done', id: 'push_warren' },
        { do: 'goto', beat: 'pump_yard' },
      ],
      cues: [
        {
          when: { zone: 'warrenSouth' },
          run: [
            { do: 'wait', seconds: 3.0 },
            say('marr.warren.minigun'),
          ],
        },
        // Wave 2 (Water Bounty Horde — 12 fresh flankers & rooftop raiders)
        {
          when: { any: [{ zone: 'warrenMid' }, { cleared: ['warren_south', 'warren_west_roof', 'warren_east_alley'] }] },
          run: [
            say('quist.warren.bounty', { now: true }),
            { do: 'release', tag: 'warren_west_roof' },
            { do: 'squad', tag: 'warren_bounty_w', men: ['trooper', 'trooper', 'gunner', 'riot'], at: 'warrenBountyWest', ensure: true },
            { do: 'squad', tag: 'warren_bounty_e', men: ['trooper', 'gunner', 'brute', 'trooper'], at: 'warrenBountyEast', ensure: true },
            { do: 'squad', tag: 'warren_bounty_n', men: ['trooper', 'gunner', 'sniper', 'riot'], at: 'warrenBountyNorth', ensure: true },
            say('radio.warren.squad'),
            say('marr.warren.push'),
          ],
        },
      ],
    },

    // -------------------------------------------------------------------------------------------
    // Section 4: The Pump Yard & Extended 50 m Dark Storm Sewer
    // -------------------------------------------------------------------------------------------
    {
      id: 'pump_yard',
      title: 'The Pump Yard & Storm Sewer',
      checkpoint: { at: 'pumpEntry', loadout: RAID_LOADOUT },
      start: [
        { do: 'callins', held: true },
        { do: 'call', name: 'chip', arg: 'thermal' },
        { do: 'threat', level: 6, grade: 'veteran' },
        { do: 'music', state: 'hard' },
        { do: 'banner', text: 'THE PUMP YARD', sub: 'SURPLUS WATER WORKS // STORM SEWER' },
        { do: 'sweep', tag: 'warren_south' },
        { do: 'sweep', tag: 'warren_west_roof' },
        { do: 'sweep', tag: 'warren_east_alley' },
        { do: 'sweep', tag: 'warren_bounty_w' },
        { do: 'sweep', tag: 'warren_bounty_e' },
        { do: 'sweep', tag: 'warren_bounty_n' },
        { do: 'call', name: 'dr.pumpStart' },
        { do: 'drop', item: 'ammo', at: 'pumpDropAmmo' },
        { do: 'drop', item: 'health', at: 'pumpDropHealth' },
        // Phase A (Pump Yard Surface): 12 fortified Saltblood pump guards
        { do: 'squad', tag: 'pump_west', men: ['trooper', 'gunner', 'warden', 'riot'], at: 'pumpWest', ensure: true },
        { do: 'squad', tag: 'pump_east', men: ['trooper', 'riot', 'sniper', 'gunner'], at: 'pumpEast', ensure: true },
        { do: 'squad', tag: 'pump_tower_guard', men: ['trooper', 'gunner', 'brute', 'warden'], at: 'pumpTowerGuard', ensure: true },
        say('marr.pump.enter'),
        { do: 'objective', id: 'cross_pump', text: 'Fight through the Pump Yard toward the Water Tower', at: 'waterTowerObj' },
        { do: 'until', when: { any: [{ signal: 'dr:tower_dropped' }, { zone: 'pumpTrigger' }, { zone: 'sewer' }, { zone: 'terracesEntry' }] } },
        { do: 'done', id: 'cross_pump' },
        say('quist.pump.tower', { now: true }),
        { do: 'wait', seconds: 1.6 },
        say('marr.pump.sewer'),
        { do: 'hint', text: 'Press [T] for your Thermal Vision brain chip — 50 m of pitch-black vaulted storm sewer ahead, packed with Saltblood ambushers!', seconds: 9 },
        { do: 'objective', id: 'enter_sewer', text: 'Drop into the west storm sewer and fight north to the exit ladder', at: 'sewerGrate' },
        { do: 'drop', item: 'health', at: 'sewerDropHealth' },
        { do: 'drop', item: 'ammo', at: 'sewerDropAmmo' },
        // Phase B (Extended Dark Storm Sewer): 3 staged underground ambush squads (11 enemies total)
        { do: 'squad', tag: 'sewer_sump', men: ['trooper', 'gunner', 'riot'], at: 'sewerSump', orders: 'ambush', ensure: true },
        { do: 'squad', tag: 'sewer_gallery', men: ['trooper', 'gunner', 'brute', 'riot', 'gunner'], at: 'sewerGallery', orders: 'ambush', ensure: true },
        { do: 'squad', tag: 'sewer_exit_guard', men: ['trooper', 'warden', 'gunner'], at: 'sewerExitGuard', orders: 'ambush', ensure: true },
        { do: 'until', when: { any: [{ zone: 'terracesEntry' }, { signal: 'dr:sewer_cleared' }] } },
        { do: 'done', id: 'enter_sewer' },
        { do: 'goto', beat: 'high_terraces' },
      ],
      cues: [
        {
          when: { zone: 'sewer' },
          run: [
            { do: 'music', state: 'easy' },
            { do: 'objective', id: 'exit_sewer', text: 'Fight through the storm sewer and climb the north ladder to the High Terraces', at: 'sewerExit' },
            say('quist.sewer.dark.1'),
            { do: 'wait', seconds: 4.5 },
            say('marr.sewer.ambush'),
            { do: 'wait', seconds: 4.0 },
            say('quist.sewer.dark.2'),
            say('marr.sewer.exit'),
          ],
        },
      ],
    },

    // -------------------------------------------------------------------------------------------
    // Section 5: The High Terraces ("The Perches" — 3-tier vertical village, y = 0 / 3.6 / 7.2)
    // -------------------------------------------------------------------------------------------
    {
      id: 'high_terraces',
      title: 'The High Terraces',
      checkpoint: { at: 'terracesStart', loadout: RAID_LOADOUT },
      start: [
        { do: 'callins', held: true },
        { do: 'call', name: 'chip', arg: 'thermal' },
        { do: 'done', id: 'exit_sewer' },
        { do: 'sweep', tag: 'pump_west' },
        { do: 'sweep', tag: 'pump_east' },
        { do: 'sweep', tag: 'pump_tower_guard' },
        { do: 'sweep', tag: 'sewer_sump' },
        { do: 'sweep', tag: 'sewer_gallery' },
        { do: 'sweep', tag: 'sewer_exit_guard' },
        { do: 'threat', level: 6, grade: 'veteran' },
        { do: 'music', state: 'hard' },
        { do: 'banner', text: 'THE HIGH TERRACES', sub: 'THE PERCHES // VERTICAL VILLAGE' },
        { do: 'call', name: 'dr.terracesStart' },
        { do: 'drop', item: 'ammo', at: 'terracesDropAmmo' },
        { do: 'drop', item: 'health', at: 'terracesDropHealth' },
        // Dense vertical combat across 3 elevations (15 upfront + 6 upper-ridge cue = 21 enemies)
        { do: 'squad', tag: 'terrace_towers_low', men: ['sniper', 'gunner', 'trooper', 'sniper'], at: 'terraceTowersLow', orders: 'hold', ensure: true },
        { do: 'squad', tag: 'terrace_tents_mid', men: ['trooper', 'trooper', 'gunner', 'sniper', 'trooper', 'gunner'], at: 'terraceTentsMid', orders: 'hold', ensure: true },
        { do: 'squad', tag: 'terrace_courtyard', men: ['trooper', 'gunner', 'riot', 'trooper', 'brute'], at: 'terraceCourtyard', ensure: true },
        say('marr.terraces.start'),
        { do: 'objective', id: 'climb_terraces', text: 'Fight uphill through the High Terraces to the Salt Cave mouth', at: 'caveMouthObj' },
        { do: 'hint', text: 'Watch the upper perches — shoot out the timber legs under watchtowers and stilted tents to drop Saltblood snipers!', seconds: 8 },
        { do: 'until', when: { any: [{ zone: 'caveEntry' }, { signal: 'dr:cave_reached' }] } },
        { do: 'done', id: 'climb_terraces' },
        { do: 'goto', beat: 'salt_cave' },
      ],
      cues: [
        {
          when: { any: [{ zone: 'terraceMidZone' }, { cleared: ['terrace_courtyard', 'terrace_towers_low'] }] },
          run: [
            say('quist.terraces.mock', { now: true }),
            { do: 'squad', tag: 'terrace_upper_guard', men: ['sniper', 'gunner', 'warden', 'brute', 'sniper', 'trooper'], at: 'terraceUpperGuard', orders: 'hold', ensure: true },
            { do: 'release', tag: 'terrace_towers_low' },
            { do: 'release', tag: 'terrace_tents_mid' },
            { do: 'drop', item: 'ammo', at: 'terracesUpperAmmo' },
            say('marr.terraces.push'),
          ],
        },
      ],
    },

    // -------------------------------------------------------------------------------------------
    // Section 6: The Salt Cave ("The Cistern Tunnels" — subterranean cavern at y = -2.5)
    // -------------------------------------------------------------------------------------------
    {
      id: 'salt_cave',
      title: 'The Salt Cave',
      checkpoint: { at: 'caveStart', loadout: RAID_LOADOUT },
      start: [
        { do: 'callins', held: true },
        { do: 'call', name: 'chip', arg: 'thermal' },
        { do: 'sweep', tag: 'terrace_towers_low' },
        { do: 'sweep', tag: 'terrace_tents_mid' },
        { do: 'sweep', tag: 'terrace_courtyard' },
        { do: 'sweep', tag: 'terrace_upper_guard' },
        { do: 'threat', level: 7, grade: 'veteran' },
        { do: 'music', state: 'hard' },
        { do: 'banner', text: 'THE SALT CAVE', sub: 'THE CISTERN TUNNELS // SUBTERRANEAN PUSH' },
        { do: 'call', name: 'dr.caveStart' },
        { do: 'drop', item: 'ammo', at: 'caveDropAmmo' },
        { do: 'drop', item: 'health', at: 'caveDropHealth' },
        // 14 Saltblood Cave Elites across entry descent (4), main pillar chamber (6) & exit vanguard (4)
        { do: 'squad', tag: 'cave_mouth_guard', men: ['trooper', 'gunner', 'riot', 'gunner'], at: 'caveMouthGuard', orders: 'hold', ensure: true },
        say('marr.cave.start'),
        { do: 'objective', id: 'push_cave', text: 'Fight through the Salt Cave to emerge at the Crashed Cargo Plane', at: 'planeEntry' },
        { do: 'hint', text: 'Close-quarters cavern fight — drop the timber mine-shoring gantries and use Thermal [T] to spot elites behind the salt pillars.', seconds: 8 },
        { do: 'until', when: { any: [{ zone: 'planeForecourtZone' }, { signal: 'dr:plane_reached' }] } },
        { do: 'done', id: 'push_cave' },
        { do: 'goto', beat: 'the_plane' },
      ],
      cues: [
        {
          when: { any: [{ zone: 'caveMidZone' }, { cleared: 'cave_mouth_guard' }] },
          run: [
            say('quist.cave.warn', { now: true }),
            { do: 'squad', tag: 'cave_chamber_main', men: ['brute', 'gunner', 'gunner', 'riot', 'warden', 'trooper'], at: 'caveChamberMain', ensure: true },
            { do: 'squad', tag: 'cave_exit_ambush', men: ['warden', 'brute', 'riot', 'gunner'], at: 'caveExitAmbush', orders: 'hold', ensure: true },
            { do: 'drop', item: 'health', at: 'caveMidHealth' },
            say('marr.cave.push'),
          ],
        },
        {
          when: { cleared: 'cave_chamber_main' },
          run: [
            { do: 'release', tag: 'cave_exit_ambush' },
          ],
        },
      ],
    },

    // -------------------------------------------------------------------------------------------
    // Section 7: The Crashed Cargo Plane (Plane Canyon hull, bulkhead locks & Quist 5-outcome finale)
    // -------------------------------------------------------------------------------------------
    {
      id: 'the_plane',
      title: 'The Crashed Cargo Plane',
      checkpoint: { at: 'planeEntry', loadout: RAID_LOADOUT },
      start: [
        { do: 'callins', held: true },
        { do: 'call', name: 'chip', arg: 'thermal' },
        { do: 'sweep', tag: 'cave_mouth_guard' },
        { do: 'sweep', tag: 'cave_chamber_main' },
        { do: 'sweep', tag: 'cave_exit_ambush' },
        { do: 'threat', level: 7, grade: 'veteran' },
        { do: 'music', state: 'hard' },
        { do: 'banner', text: 'THE PLANE', sub: 'HADREK QUIST // CRASHED FUSELAGE' },
        { do: 'door', door: 'plane.door1', open: 1, seconds: 0 },
        { do: 'door', door: 'plane.door2', open: 1, seconds: 0 },
        { do: 'drop', item: 'ammo', at: 'planeDropAmmo' },
        { do: 'drop', item: 'health', at: 'planeDropHealth' },
        // 16 welded-armor elite guards across forecourt, bay 1, bay 2, and tail
        { do: 'squad', tag: 'plane_forecourt', men: ['warden', 'gunner', 'riot', 'trooper'], at: 'planeForecourtGuard', ensure: true },
        { do: 'squad', tag: 'plane_bay1', men: ['warden', 'riot', 'gunner', 'trooper'], at: 'planeBay1', orders: 'hold', ensure: true },
        { do: 'squad', tag: 'plane_bay2', men: ['brute', 'warden', 'gunner', 'riot'], at: 'planeBay2', orders: 'hold', ensure: true },
        { do: 'squad', tag: 'plane_tail_guard', men: ['warden', 'brute', 'gunner', 'riot'], at: 'planeTailGuard', orders: 'hold', ensure: true },
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
            { do: 'release', tag: 'plane_bay1' },
            say('quist.door1', { now: true }),
            say('marr.door1.locked'),
          ],
        },
        {
          when: { all: [{ signal: 'dr:door1_slam' }, { any: [{ cleared: 'plane_bay1' }, { signal: 'dr:door1_open' }] }] },
          run: [
            { do: 'wait', seconds: 0.8 },
            { do: 'door', door: 'plane.door1', open: 1, seconds: 1.0 },
            say('marr.door1.open'),
          ],
        },
        {
          when: { zone: 'planeMid' },
          run: [
            { do: 'release', tag: 'plane_bay2' },
            { do: 'call', name: 'dr.planeAdvanceTail' },
          ],
        },
        {
          when: { signal: 'dr:door2_slam' },
          run: [
            { do: 'door', door: 'plane.door2', open: 0, seconds: 0.55 },
            { do: 'release', tag: 'plane_bay2' },
            say('quist.door2', { now: true }),
            say('marr.door2.locked'),
          ],
        },
        {
          when: { all: [{ signal: 'dr:door2_slam' }, { any: [{ cleared: 'plane_bay2' }, { signal: 'dr:door2_open' }] }] },
          run: [
            { do: 'wait', seconds: 0.8 },
            { do: 'door', door: 'plane.door2', open: 1, seconds: 1.0 },
            { do: 'release', tag: 'plane_tail_guard' },
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
    // Section 8: Escort & Exfil + Town-Flattening Ending Cutscene
    // -------------------------------------------------------------------------------------------
    {
      id: 'exfil',
      title: 'Escort & Exfil',
      checkpoint: { at: 'exfilPickup', loadout: RAID_LOADOUT },
      start: [
        { do: 'callins', held: true },
        { do: 'sweep' },
        { do: 'music', state: 'hard' },
        { do: 'banner', text: 'ESCORT & EXFIL', sub: 'CONVOY BREAKOUT // SURPLUS' },
        { do: 'call', name: 'dr.exfilArrive' },
        say('radio.exfil.arrive', { now: true }),
        say('marr.exfil.board'),
        { do: 'objective', id: 'board_convoy', text: 'Board the middle convoy truck in the forecourt', at: 'exfilPickup' },
        { do: 'hint', text: 'Press {interact} at the middle Jackal technical to mount the roof turret and break out!', seconds: 8 },
        { do: 'until', when: { signal: 'dr:exfil_boarded' } },
        { do: 'done', id: 'board_convoy' },
        { do: 'sweep', tag: 'exfil_stragglers' },
        { do: 'call', name: 'dr.exfilChase', arg: '6' },
        say('radio.exfil.chase', { now: true }),
        { do: 'objective', id: 'escape_surplus', text: 'Fight off pursuing Saltbloods down the bypass canyon road' },
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
          when: { signal: 'dr:escort_active' },
          run: [
            say('marr.escort.start'),
            { do: 'squad', tag: 'exfil_stragglers', men: ['trooper', 'trooper', 'gunner', 'riot', 'gunner'], at: 'exfilStragglers', ensure: true },
            { do: 'hint', text: 'Escort cuffed Quist from the tail to the middle truck — watch for falling scrap and Saltblood stragglers!', seconds: 9 },
          ],
        },
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
