/**
 * Entry point.
 *   /                 -> the game
 *   /?sandbox=<name>  -> src/sandbox/<name>.ts (default export is an async function)
 */
const params = new URLSearchParams(location.search);
const sandbox = params.get('sandbox');

async function boot(): Promise<void> {
  if (sandbox) {
    const mods = import.meta.glob<{ default: (params: URLSearchParams) => Promise<void> }>('./sandbox/*.ts');
    const load = mods[`./sandbox/${sandbox}.ts`];
    if (!load) throw new Error(`Unknown sandbox "${sandbox}". Available: ${Object.keys(mods).join(', ')}`);
    const mod = await load();
    await mod.default(params);
    return;
  }
  const { startGame } = await import('./core/Game');
  await startGame(params);
}

boot().catch(async err => {
  console.error(err);
  // A co-op match's handoff was read on the way in: put it back so Reload rejoins the match. Loaded already, so no fetch.
  await import('./net/session').then(s => s.restoreHandoff()).catch(() => {});
  // AssetError.network: retries ran out. A lazy chunk that would not download is the same hiccup.
  const network = err?.network === true || /Failed to fetch|dynamically imported module|NetworkError|Load failed/i.test(String(err?.message));
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;padding:24px;background:#120000;color:#ff6a5a;font:14px monospace;white-space:pre-wrap;z-index:9999;overflow:auto';
  const head = document.createElement('div');
  head.style.cssText = 'font-size:22px;margin-bottom:16px';
  head.textContent = network ? 'Network hiccup while loading.' : 'Boot failed';
  const reload = document.createElement('button');
  reload.textContent = 'Reload';
  reload.style.cssText = 'font:18px monospace;padding:8px 24px;margin-bottom:24px;cursor:pointer';
  reload.onclick = () => location.reload();
  const detail = document.createElement('div');
  detail.style.cssText = 'opacity:0.7';
  detail.textContent = network ? String(err?.message ?? err) : String(err?.stack ?? err);
  el.append(head, reload, detail);
  document.body.appendChild(el);
});
