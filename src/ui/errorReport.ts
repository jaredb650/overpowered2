import { ERRORS, type ErrorCode } from '../core/errors';
import { reporter, scrub } from '../core/report';

/** The game's look in inline styles, with fallbacks: at boot the game's CSS (fonts, colours) may not be loaded yet. */
const MONO = "var(--mono, ui-monospace, Menlo, Consolas, 'DejaVu Sans Mono', monospace)";
const BUTTON = "appearance:none;border:0;padding:0.1rem 0.9rem;margin:0.6rem 0.6rem 0.2rem 0;background:var(--ink, #eef4f7);color:#000;font:1.3rem/1.2 var(--display, Impact, 'Arial Narrow', sans-serif);cursor:pointer";

/** Standalone DOM: works even when the rest of the UI failed to load. Matches the lobby's error box and buttons. */
export function errorPanel(code: ErrorCode, technical: unknown = ''): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'op2-error';
  panel.style.cssText = `margin:0.7rem 0 0.3rem;font:1.1rem/1.35 ${MONO};color:var(--ink, #eef4f7);white-space:normal`;
  const title = document.createElement('p'); title.textContent = ERRORS[code][0];
  title.style.cssText = 'margin:0;padding:0.4rem 0.6rem;background:rgba(255, 28, 43, 0.16);border-left:0.2rem solid var(--blood, #ff1c2b)';
  const reload = document.createElement('button'); reload.textContent = 'Reload'; reload.onclick = () => location.reload();
  const details = document.createElement('details');
  details.style.cssText = 'margin-top:0.3rem;color:var(--steel, #9db0bd);font-size:1rem';
  const summary = document.createElement('summary'); summary.textContent = 'Details';
  summary.style.cursor = 'pointer';
  const text = document.createElement('pre'); text.style.cssText = `margin:0.4rem 0 0;white-space:pre-wrap;overflow-wrap:anywhere;font:0.9rem/1.35 ${MONO}`;
  const error = technical as { stack?: string; message?: string } | null;
  text.textContent = `${code}\n${scrub(error?.stack ?? error?.message ?? technical, 1600)}`;
  const copy = document.createElement('button'); copy.textContent = 'Copy error report';
  copy.onclick = async () => {
    const payload = `${text.textContent}\n${reporter.copyText()}`;
    try { await navigator.clipboard.writeText(payload); copy.textContent = 'Copied'; }
    catch { const field = document.createElement('textarea'); field.value = payload; details.append(field); field.select(); copy.textContent = 'Select text and copy'; }
  };
  for (const button of [reload, copy]) {
    button.type = 'button';
    button.style.cssText = BUTTON;
    button.onpointerenter = () => { button.style.background = 'var(--hot, #ff5a14)'; };
    button.onpointerleave = () => { button.style.background = 'var(--ink, #eef4f7)'; };
  }
  details.append(summary, text, copy); panel.append(title, reload, details);
  return panel;
}
export function showFatalError(code: ErrorCode, error: unknown): void {
  if (document.getElementById('op2-fatal-error')) return;
  document.exitPointerLock?.();
  const overlay = document.createElement('div'); overlay.id = 'op2-fatal-error';
  overlay.style.cssText = 'position:fixed;inset:0;padding:3rem;background:#0b0e12;z-index:99999;overflow:auto';
  const panel = errorPanel(code, error);
  panel.style.maxWidth = '50rem';
  overlay.append(panel); document.body.append(overlay);
}
