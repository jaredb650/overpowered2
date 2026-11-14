/**
 * Which contract this page is running. A map cannot be swapped under a running world, so changing contract is a page
 * load: the URL is the only state, and `/` is always the default contract.
 *
 *   ?contract=outpost               The contract, on its own map
 *   ?map=killhouse                  The contract that plays there, or the default if none does, as on ?map=range
 *   ?contract=crucible&map=killhouse  Those rules on that map. Unranked, so a test cannot set a record
 *   ?unlock=1                       Every locked contract is open, for this page and any it moves on to. The dev server opens them anyway
 *   ?unlock=0                       On the dev server, the locks stay as a new player has them
 *   ?dev=1                          The dev panel (F1 or backquote), in any build, the public site included
 *   ?dev=0                          On the dev server, no dev panel. It loads on every other page there (core/devflags.ts)
 *   ?rules=0                        The Crucible plays its standard rules, whatever the player has set (contracts/crucible.ts)
 *
 * Every flag but ?map and ?autostart rides along when the menu moves to another contract.
 */
import type { MapId } from '../world/map/maps';
import { CONTRACTS, DEFAULT_CONTRACT, type ContractDef, type ContractId } from './data';

export interface ActiveContract {
  def: ContractDef;
  map: MapId;
  /** False on a map the contract does not own. Scores are neither read nor kept. */
  ranked: boolean;
}

/** A record, not a list, so a new map that is missing here fails the typecheck. The real table imports three.js. */
const MAP_IDS: Record<MapId, true> = { crucible: true, killhouse: true, outpost: true, fort: true, range: true };

export function pickContract(contract: string | null, map: string | null): ActiveContract {
  const namedMap = map !== null && map in MAP_IDS ? (map as MapId) : null;
  // The Test Range is the lab's, whoever borrows it: `?map=range` stays the Crucible's rules.
  const owner = namedMap === 'range' ? undefined : CONTRACTS.find(c => c.map === namedMap);
  const def = CONTRACTS.find(c => c.id === contract) ?? owner ?? DEFAULT_CONTRACT;
  const resolved = namedMap ?? def.map;
  return { def, map: resolved, ranked: resolved === def.map };
}

const search = typeof location === 'undefined' ? '' : location.search;
const query = new URLSearchParams(search);

/** Fixed for the life of the page. */
export const ACTIVE: ActiveContract = pickContract(query.get('contract'), query.get('map'));

/** The URL asked for this contract, where a bare one only fell through to the default. */
export const NAMED: boolean = query.has('contract') || query.has('map');

/** Where to send the browser to run `id`. Dev flags ride along; anything that named the old map or skipped the menu does not. */
export function contractSearch(id: ContractId, from: string): string {
  const next = new URLSearchParams(from);
  next.delete('map');
  next.delete('autostart');
  next.set('contract', id);
  next.set('deploy', '1');
  return `?${next.toString()}`;
}

/**
 * True once, on the load that a contract switch caused. The splash then goes straight into the run, and the flag leaves
 * the URL, so a refresh does not read as a fresh deployment.
 */
export function takeDeploy(): boolean {
  if (query.get('deploy') !== '1') return false;
  query.delete('deploy');
  const rest = query.toString();
  history.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}`);
  return true;
}
