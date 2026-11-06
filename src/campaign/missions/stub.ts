/**
 * The smallest mission that uses everything, on the Kill House: `/?mission=stub&map=killhouse&autostart=1`. It is here to be copied
 * and to prove the runner in the real game. It has no story to speak of.
 */
import type { Line } from '../../enemies/commander/lines';
import type { Mission } from '../types';

const LINES: readonly Line[] = [
  { id: 'stub.council.open', speaker: 'council', emotion: 'deadpan', text: 'This is a test of the Office of Societal Compliance. Please remain exterminated.' },
  { id: 'stub.commander.gate', speaker: 'commander', emotion: 'smug', text: 'Door\'s shut. Come in when you have an appointment.' },
  { id: 'stub.commander.contact', speaker: 'commander', emotion: 'smug', text: 'Two squads. Try not to enjoy it.' },
  { id: 'stub.commander.again', speaker: 'commander', emotion: 'smug', text: 'You again. We kept your seat warm.' },
  { id: 'stub.commander.person', speaker: 'commander', emotion: 'cracked', text: 'Fine. I will do it myself.' },
  { id: 'stub.commander.half', speaker: 'commander', emotion: 'cracked', text: 'That hurt. I am writing that down.' },
  { id: 'stub.radio.end', speaker: 'radio', emotion: 'urgent', text: 'That is the whole test. Stand by for paperwork.' },
];

export const STUB: Mission = {
  id: 'stub',
  title: 'Runner test',
  loadout: { weapons: ['smg', 'sword'], grenades: 0 },
  zones: {
    northDoor: { min: [-7, -1, -12], max: [0, 6, -6.5] },
  },
  marks: {
    court: { at: [6.6, 0.1, 3], yaw: Math.PI / 2 },
    northDoor: { at: [-3.5, 0, -8] },
    yardSouth: { at: [0, 0, 30] },
    yardNorth: { at: [0, 0, -30] },
    rack: { at: [0, 0, 5] },
    truckIn: { at: [-30, 0, 30] },
    truckStop: { at: [-18, 0, 30] },
  },
  routes: {
    truck: ['truckIn', 'truckStop'],
  },
  doors: {
    north: { at: [-3.5, 0, -9], yaw: 0, width: 5, height: 4.2, kind: 'shutter', seconds: 1.4, start: 1 },
  },
  cutscenes: {
    briefing: {
      shots: [
        { from: [30, 28, 30], to: [14, 16, 14], lookFrom: [0, 0, 0], lookTo: [0, 2, 0], seconds: 5 },
        { from: [-20, 9, -2], to: [-6, 6, 8], lookFrom: [0, 3, -9], lookTo: [-3.5, 2, -9], seconds: 3 },
      ],
    },
  },
  lines: LINES,
  redeployLines: ['stub.commander.again'],
  beats: [
    {
      id: 'briefing',
      title: 'Briefing',
      start: [
        { do: 'say', line: 'stub.council.open' },
        { do: 'cutscene', id: 'briefing' },
        { do: 'signal', name: 'briefed' },
      ],
      until: { signal: 'briefed' },
    },
    {
      id: 'insertion',
      title: 'Door gun',
      start: [
        { do: 'squad', tag: 'targets', men: ['trooper', 'trooper', 'trooper'], at: 'yardNorth', orders: 'hold' },
        { do: 'ride', seat: 'doorGunner' },
        { do: 'signal', name: 'landed' },
      ],
      until: { signal: 'landed' },
    },
    {
      id: 'lockout',
      title: 'Locked out',
      checkpoint: { at: 'court', loadout: { weapons: ['smg', 'sword'], grenades: 0 } },
      start: [
        { do: 'objective', id: 'door', text: 'Reach the north door', at: 'northDoor' },
        { do: 'hint', text: 'Hold {forward} to move. This is only a test.' },
      ],
      cues: [{
        when: { zone: 'northDoor' },
        run: [
          { do: 'door', door: 'north', open: 0, wait: true },
          { do: 'say', line: 'stub.commander.gate' },
          { do: 'done', id: 'door' },
          { do: 'signal', name: 'locked' },
        ],
      }],
      until: { signal: 'locked' },
    },
    {
      id: 'contact',
      title: 'Contact',
      checkpoint: { at: 'court', loadout: { weapons: ['smg', 'sword'], grenades: 0 } },
      start: [
        { do: 'threat', level: 2 },
        { do: 'music', state: 'easy' },
        { do: 'say', line: 'stub.commander.contact' },
        { do: 'objective', id: 'clear', text: 'Kill them all' },
        { do: 'squad', tag: 'alpha', men: ['trooper', 'gunner', 'trooper', 'brute'], at: 'yardSouth', orders: 'hold' },
        { do: 'vehicle', tag: 'truck', kind: 'humvee', at: 'truckIn', route: 'truck', crew: ['trooper', 'trooper', 'gunner'], crewTag: 'truckCrew' },
      ],
      cues: [{ when: { after: 3 }, run: [{ do: 'release', tag: 'alpha' }] }],
      until: { cleared: ['alpha', 'truckCrew'] },
    },
    {
      id: 'armoury',
      title: 'Rocket',
      checkpoint: { at: 'court', loadout: { weapons: ['smg', 'sword'], grenades: 0 } },
      start: [
        { do: 'done', id: 'clear' },
        { do: 'door', door: 'north', open: 1 },
        { do: 'objective', id: 'rocket', text: 'Take the launcher', at: 'rack' },
        { do: 'rack', weapon: 'rocket', at: 'rack' },
        { do: 'adapt' },
        { do: 'field', answer: 'spread' },
      ],
      until: { signal: 'took:rocket' },
    },
    {
      id: 'boss',
      title: 'The man himself',
      checkpoint: { at: 'court', loadout: { weapons: ['rocket', 'smg', 'sword'], grenades: 1 } },
      start: [
        { do: 'done', id: 'rocket' },
        { do: 'say', line: 'stub.commander.person' },
        { do: 'objective', id: 'boss', text: 'Kill the Commander' },
        { do: 'boss', tag: 'him', at: 'court' },
      ],
      cues: [{ when: { below: 0.5, tag: 'him' }, run: [{ do: 'say', line: 'stub.commander.half' }] }],
      until: { cleared: 'him' },
    },
    {
      id: 'done',
      title: 'Paperwork',
      start: [
        { do: 'done', id: 'boss' },
        { do: 'sweep' },
        { do: 'say', line: 'stub.radio.end', wait: true },
        { do: 'finish' },
      ],
    },
  ],
};
