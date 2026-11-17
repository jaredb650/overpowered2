/** The tag is a triage hint, not proof of who caused a particular failure. */
export const ERRORS = {
  ASSET_FETCH_FAILED: ['A download was interrupted. Check your connection, then reload.', 'network'],
  CODE_CHUNK_FAILED: ['A part of the game did not download. Check your connection, then reload.', 'network'],
  ASSET_404: ['A game file is missing. Reload to get the latest version.', 'us'],
  WEBGL_UNAVAILABLE: ['3D graphics could not start. Enable hardware acceleration or try another browser.', 'device'],
  OUT_OF_MEMORY: ['The game ran out of memory. Close other tabs and reload with lower graphics settings.', 'device'],
  WEBGL_CONTEXT_LOST: ['Your graphics device stopped responding. Close other graphics apps, then reload.', 'device'],
  SHADER_COMPILE: ['A graphics effect could not start. Try updating your browser or lowering graphics quality.', 'us/device'],
  COOP_RELAYS_UNREACHABLE: ['The lobby servers could not be reached. Check your connection or VPN, then try again.', 'network'],
  COOP_LOBBY_NOT_FOUND: ['The lobby could not be found. Check the code with the host and try again.', 'network'],
  COOP_ICE_FAILED_NO_TURN: ["Couldn't connect. One of your networks blocks direct connections. Have one player switch networks (e.g. a phone hotspot).", 'network'],
  COOP_CONNECT_FAILED: ["Couldn't connect, even through the relay server. Have one player switch networks (e.g. a phone hotspot).", 'network'],
  COOP_SAME_LAN_BLOCKED: ["Couldn't connect. You may be on the same network as the host — some routers block that. Check your router settings, or have one player switch networks (e.g. a phone hotspot).", 'network'],
  COOP_VERSION_MISMATCH: ['Your game versions differ. Both players should hard reload (Cmd/Ctrl+Shift+R).', 'user'],
  COOP_WRONG_PASSWORD: ['Wrong password. Check it with the host and try again.', 'user'],
  COOP_HOST_LEFT: ['The host left, so the lobby closed.', 'user'],
  COOP_KICKED: ['You were removed from the lobby.', 'user'],
  COOP_DESYNC: ['The games fell out of sync. Leave and rejoin the match.', 'us'],
  COOP_FULL: ['That lobby is full. Ask the host to make room.', 'user'],
  COOP_CODE_TAKEN: ['That lobby code is already in use. Host again for a fresh code.', 'user'],
  COOP_DISCONNECTED: ['The connection was lost. Check with the host, then rejoin.', 'network'],
  UNCAUGHT_EXCEPTION: ['Something went wrong in the game. Reload to try again.', 'us'],
  BOOT_OK: ['Game loaded.', 'info'],
  COOP_ATTEMPT: ['Starting co-op connection.', 'info'],
  COOP_STAGE: ['Co-op connection progressing.', 'info'],
  COOP_CONNECTED: ['Co-op connected.', 'info'],
  COOP_PEER_LEFT: ['A player disconnected.', 'info'],
} as const;
export type ErrorCode = keyof typeof ERRORS;

export function classifyError(error: unknown): ErrorCode {
  const e = error as { message?: string; network?: boolean; reason?: string; status?: number } | null;
  const text = `${e?.message ?? error} ${e?.reason ?? ''}`;
  if ((error as Error | null)?.name === 'ChunkError') return 'CODE_CHUNK_FAILED';
  if (e?.status === 404 || /\b404\b/.test(text)) return 'ASSET_404';
  if (/out of memory|allocation failed|memory access out of bounds/i.test(text)) return 'OUT_OF_MEMORY';
  if (/context lost/i.test(text)) return 'WEBGL_CONTEXT_LOST';
  if (/shader|VALIDATE_STATUS|compile.*program/i.test(text)) return 'SHADER_COMPILE';
  if (/webgl|graphics context/i.test(text)) return 'WEBGL_UNAVAILABLE';
  if (e?.network || /failed to fetch|fetch failed|networkerror|load failed|dynamically imported module|download|HTTP 5\d\d|HTTP 429/i.test(text)) return 'ASSET_FETCH_FAILED';
  return 'UNCAUGHT_EXCEPTION';
}

export function coopErrorCode(error: string, sameLan = false, turn = false): ErrorCode {
  const codes: Record<string, ErrorCode> = { password: 'COOP_WRONG_PASSWORD', version: 'COOP_VERSION_MISMATCH', 'host-left': 'COOP_HOST_LEFT',
    'no-host': 'COOP_LOBBY_NOT_FOUND', relays: 'COOP_RELAYS_UNREACHABLE', lost: 'COOP_DISCONNECTED', full: 'COOP_FULL',
    'code-taken': 'COOP_CODE_TAKEN', kicked: 'COOP_KICKED', desync: 'COOP_DESYNC' };
  return codes[error] ?? (sameLan ? 'COOP_SAME_LAN_BLOCKED' : turn ? 'COOP_CONNECT_FAILED' : 'COOP_ICE_FAILED_NO_TURN');
}
