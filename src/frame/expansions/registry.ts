/** Core Expansion plug-in registry (`Q` key). */
import type { Ctx } from '../../core/contracts';
import type { ExpansionKind } from '../loadout';
import { AEGIS_EXPANSION } from './aegis';
import { DOME_EXPANSION } from './dome';
import { NOVA_EXPANSION } from './nova';
import { SMOKE_EXPANSION } from './smoke';
import { TERMINAL_EXPANSION } from './terminal';
import type { ExpansionPlugin } from './types';

export const EXPANSION_REGISTRY: Readonly<Record<ExpansionKind, ExpansionPlugin>> = {
  smoke: SMOKE_EXPANSION,
  nova: NOVA_EXPANSION,
  aegis: AEGIS_EXPANSION,
  dome: DOME_EXPANSION,
  terminal: TERMINAL_EXPANSION,
};

export const EXPANSION_KINDS: readonly ExpansionKind[] = ['smoke', 'nova', 'aegis', 'dome', 'terminal'];

export function dispatchExpansionRemoteNews(ctx: Ctx, values: number[]): boolean {
  const kind = EXPANSION_KINDS[Math.round(values[0] ?? -1)];
  if (!kind) return false;
  EXPANSION_REGISTRY[kind].remoteNews?.(ctx, values);
  return true;
}
