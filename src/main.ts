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

boot().catch(err => {
  console.error(err);
  const el = document.createElement('pre');
  el.style.cssText = 'position:fixed;inset:0;margin:0;padding:24px;background:#120000;color:#ff6a5a;font:14px monospace;white-space:pre-wrap;z-index:9999';
  el.textContent = `Boot failed\n\n${err?.stack ?? err}`;
  document.body.appendChild(el);
});
