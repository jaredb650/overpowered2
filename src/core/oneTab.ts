/**
 * One running game per browser. Tabs share localStorage (settings are saved whole, so the last tab to save wins), and
 * each co-op tab is a separate player: a second tab on an invite link took a second seat under the same callsign.
 * A Web Lock decides which tab runs (atomic, and freed by the browser when that tab closes or crashes); a BroadcastChannel
 * asks the running tab to step aside when another tab's "Play here instead" is pressed. Runs before the game boots, so a
 * waiting tab costs nothing.
 */
const NAME = 'op2-game';

/**
 * What the running tab is doing that another tab taking over would end: set by the co-op session while a match is on
 * (net/index.ts), '' otherwise. A waiting tab asks, so its notice can say what "Play here instead" will cost.
 */
export const tabBusy = { coop: '' as '' | 'host' | 'guest' };

/** Resolves once this tab may run the game: at once, or after the player chooses "Play here instead". */
export async function claimTab(): Promise<void> {
  const locks = globalThis.navigator?.locks;
  // shortcut: a browser without Web Locks (pre-2022) or BroadcastChannel runs every tab, as before.
  if (!locks || typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(NAME);
  // The lock is held for the page's whole life: its callback's promise never settles.
  const take = (ifAvailable: boolean) => new Promise<boolean>(resolve =>
    void locks.request(NAME, { ifAvailable }, lock => (resolve(!!lock), lock ? new Promise<never>(() => {}) : undefined)));
  if (!(await take(true))) {
    const notice = waitingNotice();
    // The running tab says whether a co-op match is on there: taking over makes it reload, which leaves the match.
    channel.onmessage = event => {
      const coop = (event.data as { coop?: string } | null)?.coop;
      if (coop === 'host') notice.warn.textContent = 'A co-op match is being hosted in that tab. Playing here instead ends it for everyone in it.';
      else if (coop === 'guest') notice.warn.textContent = 'A co-op match is being played in that tab. Playing here instead takes you out of it.';
      else if (coop === '') notice.warn.textContent = '';
    };
    channel.postMessage('ask');
    await new Promise<void>(resolve => notice.button.addEventListener('click', () => resolve(), { once: true }));
    notice.button.disabled = true;
    notice.button.textContent = 'Switching...';
    channel.postMessage('take');
    await take(false);
    notice.el.remove();
  }
  // Another tab took over: reload into the waiting notice, which leaves any co-op room and frees the lock.
  channel.onmessage = event => {
    if (event.data === 'take') location.reload();
    else if (event.data === 'ask') channel.postMessage({ coop: tabBusy.coop });
  };
}

function waitingNotice(): { el: HTMLElement; button: HTMLButtonElement; warn: HTMLElement } {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1.5rem;padding:1.5rem;background:#0b0e12;color:#eef4f7;font:1.25rem/1.4 ui-monospace, Menlo, Consolas, monospace;text-align:center;z-index:99999';
  const text = document.createElement('p');
  text.style.margin = '0';
  text.textContent = 'OVERPOWERED 2 is already open in another tab.';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Play here instead';
  button.style.cssText = "appearance:none;border:0;padding:0.2rem 1.2rem;background:#eef4f7;color:#000;font:1.6rem/1.2 Impact, 'Arial Narrow', sans-serif;cursor:pointer";
  const warn = document.createElement('p');
  warn.style.cssText = 'margin:0;max-width:44rem;color:#ffb33d;font-size:1.05rem';
  el.append(text, warn, button);
  document.body.append(el);
  return { el, button, warn };
}
