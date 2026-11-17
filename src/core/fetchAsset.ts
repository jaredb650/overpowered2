/**
 * fetch for game files, built for flaky connections (a phone hotspot drops a request now and then): a network error,
 * a 5xx or a 429 gets up to `tries` attempts with a short growing pause; any other failure (404) throws at once.
 * `read` runs inside the retry too, since a body can break off half way.
 */
export class AssetError extends Error {
  constructor(readonly url: string, readonly reason: string, readonly network: boolean) {
    super(`${network ? 'Could not download' : 'Missing'} ${url} (${reason})`);
    this.name = 'AssetError';
  }
}

export async function fetchAsset<T>(url: string, read: (response: Response) => Promise<T>, tries = 3,
  fetcher: typeof fetch = (...args) => fetch(...args), pause = (ms: number) => new Promise<void>(r => setTimeout(r, ms))): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    let reason: string;
    try {
      const response = await fetcher(url);
      if (response.ok) return await read(response);
      reason = `HTTP ${response.status}`;
      if (response.status !== 429 && response.status < 500) throw new AssetError(url, reason, false);
    } catch (error) {
      if (error instanceof AssetError) throw error;
      reason = error instanceof Error ? error.message : String(error);
    }
    if (attempt >= tries) throw new AssetError(url, reason, true);
    console.warn(`[assets] ${url}: ${reason}, trying again`);
    await pause(500 * attempt);
  }
}
