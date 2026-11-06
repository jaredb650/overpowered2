import type { Ctx } from '../core/contracts';
import { CharacterLibraryImpl } from './CharacterLibrary';

export type { CharacterLibraryImpl } from './CharacterLibrary';
export { ARCHETYPES, archetypeById } from './archetypes';

export function createCharacterLibrary(ctx: Ctx): CharacterLibraryImpl {
  return new CharacterLibraryImpl(ctx);
}
