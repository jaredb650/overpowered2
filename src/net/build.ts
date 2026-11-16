/** This build's id, the short commit hash (vite.config.ts). Every push redeploys, so friends compare it in the lobby. */
declare const __BUILD__: string | undefined;
export const BUILD: string = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev';
