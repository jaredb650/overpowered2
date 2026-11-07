/**
 * Which contract this page is running. A map cannot be swapped under a running world, so changing contract is a page
 * load: the URL is the only state, and `/` is always the default contract.
 *
 *   ?contract=outpost               The contract, on its own map
 *   ?map=killhouse                  The contract that plays there, or the default if none does, as on ?map=range
 *   ?contract=crucible&map=killhouse  Those rules on that map. Unranked, so a test cannot set a record
 *   ?unlock=1                       Every locked contract is open, for this page and any it moves on to
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
const MAP_IDS: Record<MapId, true> = { crucible: true, killhouse: true, outpost: true, range: true };

export function pickContract(contract: string | null, map: string | null): ActiveContract {
  const namedMap = map !== null && map in MAP_IDS ? (map as MapId) : null;
  const def = CONTRACTS.find(c => c.id === contract) ?? CONTRACTS.find(c => c.map === namedMap) ?? DEFAULT_CONTRACT;
  const resolved = namedMap ?? def.map;
  return { def, map: resolved, ranked: resolved === def.map };
}

const search = typeof location === 'undefined' ? '' : location.search;
const query = new URLSearchParams(search);

/** Fixed for the life of the page. */
export const ACTIVE: ActiveContract = pickContract(query.get('contract'), query.get('map'));

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
