/**
 * How the world's events travel inside a batch (net/batch.ts): each as a packed tree (net/tree.ts), kind 1, which reads
 * back as exactly what JSON would have carried, in about half the bytes. Nothing here knows an event's shape: the modules
 * build their events as they always did, and a new event type needs no entry anywhere.
 *
 * `WORDS` are the strings both ends know by number: the first 64 cost one byte each, the rest two. A word missing from
 * the list still travels, as its letters. Both ends are always the same build, so the list can be reordered or added to
 * at will; put what the busiest events carry first.
 */
import { PACKED_ROOM, batchOf as batchWith, unbatch as unbatchWith, type Packer } from '../batch';
import { Words, decodeTree, encodeTree } from '../tree';
import type { WorldEvent } from '../worldProtocol';

export const KIND_TREE = 1;

export const WORDS = new Words([
  // One byte each: the keys and names of the events sent most (hits, kills, shots, the team's cards, moves).
  't', 'u', 'uid', 'by', 'h', 'a', 'f', 'd', 'k', 'c', 'slot', 'at', 'n', 's', 'v', 'id', 'i',
  'hitfx', 'kill', 'fire', 'hit', 'team', 'card', 'move', 'sever', 'cnews', 'ack', 'say', 'boom', 'round', 'loop', 'status',
  'list', 'weapon', 'origin', 'dir', 'yaw', 'shot', 'target', 'damage', 'amount', 'type', 'point', 'force', 'source', 'region', 'bone',
  'hop', 'kind', 'state', 'bleed', 'life', 'hp', 'max', 'armor', 'kills', 'score', 'credits', 'downs', 'revives', 'ping', 'cheats', 'menu', 'ok',
  // Two bytes each. Keys:
  'gib', 'head', 'from', 'to', 'p', 'o', 'src', 'x', 'y', 'z', 'r', 'b', 'l', 'q', 'w', 'e', 'g', 'm', 'op', 'on', 'args', 'wave', 'ht', 'full', 'radius',
  'act', 'label', 'left', 'in', 'why', 'scale', 'phase', 'alive', 'snd', 'tr', 'points', 'add', 'ms', 'sz', 'now', 'dead', 'seed', 'boss', 'total', 'how',
  'lit', 'gone', 'put', 'loud', 'power', 'pay', 'color', 'gun', 'inst', 'severed', 'seconds', 'flags', 'posture', 'wz', 'line', 'name', 'rank', 'squad',
  'slots', 'voice', 'age', 'mods', 'most', 'turret', 'ap', 'ad', 'bonus', 'won', 'kit', 'ready', 'need', 'push', 'player', 'settled', 'take', 'lock',
  'pieces', 'blocked', 'text', 'pitch', 'part', 'vars', 'flag', 'tier', 'st', 'off', 'mz', 'vol', 'fu', 'reactor', 'set', 'chairs', 'radio', 'supply',
  'wid', 'marks', 'reveal', 'questioned', 'sh', 'titan', 'cards', 'rest', 'custom', 'sc', 'of', 'nm', 'shop', 'delay', 'ring', 'tc', 'fk', 'tg', 'hx',
  'next', 'guns', 'current', 'grenades', 'stims', 'implants', 'implantsFitted', 'implantSlots', 'chips', 'chipsFitted', 'chipSlots', 'callIns', 'combo',
  'headshots', 'severMult', 'reach', 'blastKind', 'pierces', 'armorPiercing', 'vaporize', 'load', 'armour', 'torso', 'spill', 'slicePlaneNormal',
  // The other events' names:
  'vhit', 'nack', 'held', 'mfx', 'kata', 'hurt', 'shove', 'ghost', 'ray', 'proj', 'projx', 'projhit', 'efx', 'atk', 'atkf', 'atke', 'bossfx', 'zone', 'glint',
  'laser', 'shock', 'strike', 'bang', 'cmd', 'callin', 'cin', 'mech', 'aadown', 'pfx', 'airlift', 'sonar', 'chatter', 'chatcut', 'slow', 'slowstate',
  'slowno', 'capture', 'credit', 'prisoner', 'award', 'who', 'pod', 'prop', 'worldsync', 'vehicles', 'wreck', 'fort', 'fortstate', 'wallblast', 'wallhit',
  'repair', 'repaired', 'fortbuy', 'fortsold', 'shell', 'fortsay', 'fortradio', 'gunseat', 'dev', 'devshot', 'snared', 'shutter', 'smoke', 'allies',
  'ashot', 'aorder', 'arefund', 'note', 'jam', 'revive', 'up', 'over', 'restore', 'vote', 'sync', 'mark', 'mission', 'gather',
  // Values: guns, enemies, kinds of damage, places on a body, states.
  'smg', 'shotgun', 'rocket', 'autocannon', 'sword', 'judge', 'lance', 'buzzsaw', 'kiln', 'stakegun', 'harrow', 'rivet', 'sabot', 'quiver', 'mgl', 'satchel', 'howitzer', 'thresher',
  'knife', 'crowbar', 'shovel', 'baton', 'piledriver', 'metalstorm', 'deuce', 'ultramag', 'autoraffica', 'gimlet', 'awl', 'flail', 'billhook', 'bodkin', 'autoclave', 'gaff', 'grenade',
  'husk', 'trooper', 'gunner', 'brute', 'stalker', 'riot', 'sniper', 'rocketeer', 'leaper', 'bomber', 'burner', 'warden', 'skitter', 'drone', 'juggernaut', 'titan',
  'bullet', 'pellet', 'explosive', 'melee', 'slash', 'crush', 'true', 'burn', 'freeze', 'bolt',
  'chest', 'abdomen', 'armL', 'forearmL', 'armR', 'forearmR', 'legL', 'shinL', 'legR', 'shinR',
  'down', 'respawn', 'start', 'clear', 'intermission', 'active', 'rail', 'beam', 'ball', 'giant', 'hose', 'swing', 'spin',
  'stagger', 'stumble', 'daze', 'roar', 'land', 'leap', 'block', 'getUp', 'crucible', 'outpost', 'defense', 'campaign', 'foreclosure',
  'dragon', 'wp', 'cl', 'rocket_wp', 'howitzer_cluster',
  'rooftop', 'badlands', 'dogfight', 'drv', 'drvx', 'drvf', 'drvs', 'drvg', 'vhijack', 'vhijackok', 'pool',
  'join', 'leave', 'swap', 'ty', 'tp',
  'dfstate', 'dfhit', 'dfshatter', 'dfbuy', 'dfnext', 'dfflare', 'dfrwr', 'dfdmg',
  'hornet', 'harrier', 'warthog', 'lancer', 'raptor', 'jackal', 'aegis', 'kestrel', 'viper', 'bastion', 'valkyrie', 'quad', 'moto',
]);

/** Every world event as a packed tree. An event the tree cannot carry exactly as JSON would (none today) goes as JSON. */
export const worldPacker: Packer<WorldEvent> = {
  pack(event, into, at) {
    const end = encodeTree(event, into, at, PACKED_ROOM, WORDS);
    return end < 0 ? null : [KIND_TREE, end];
  },
  unpack(kind, payload) {
    if (kind !== KIND_TREE) return null;
    const event = decodeTree(payload, WORDS);
    return event === undefined ? null : event as WorldEvent;
  },
};


/** For tests and tools: a batch message of world events as a page of the match `matchId` would send it. */
export const batchOf = (matchId: string, events: readonly unknown[]): Uint8Array => batchWith(matchId, events as WorldEvent[], worldPacker);
/** For tests and tools: every world event in a batch message. */
export const unbatch = <T = WorldEvent>(data: unknown): T[] => unbatchWith<WorldEvent>(data, worldPacker) as T[];
/** For tests and tools: the first (a page that is not batching sends one event a message). */
export const eventOf = <T = WorldEvent>(data: unknown): T => unbatch<T>(data)[0] as T;
