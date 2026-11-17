import { ERRORS, type ErrorCode } from '../core/errors';
import { reporter, scrub } from '../core/report';

/** Standalone DOM: works even when the rest of the UI failed to load. */
export function errorPanel(code: ErrorCode, technical: unknown = ''): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'op2-error';
  panel.style.cssText = 'font:14px/1.5 monospace;max-width:760px;white-space:normal';
  const title = document.createElement('p'); title.textContent = ERRORS[code][0];
  title.style.cssText = 'font-size:20px;color:#ffd8b3';
  const reload = document.createElement('button'); reload.textContent = 'Reload'; reload.onclick = () => location.reload();
  const details = document.createElement('details');
  const summary = document.createElement('summary'); summary.textContent = 'Details';
  const text = document.createElement('pre'); text.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px';
  const error = technical as { stack?: string; message?: string } | null;
  text.textContent = `${code}\n${scrub(error?.stack ?? error?.message ?? technical, 1600)}`;
  const copy = document.createElement('button'); copy.textContent = 'Copy error report';
  copy.onclick = async () => {
    const payload = `${text.textContent}\n${reporter.copyText()}`;
    try { await navigator.clipboard.writeText(payload); copy.textContent = 'Copied'; }
    catch { const field = document.createElement('textarea'); field.value = payload; details.append(field); field.select(); copy.textContent = 'Select text and copy'; }
  };
  for (const button of [reload, copy]) button.style.cssText = 'font:14px monospace;padding:8px 16px;margin:8px 8px 8px 0;cursor:pointer';
  details.append(summary, text, copy); panel.append(title, reload, details);
  return panel;
}
export function showFatalError(code: ErrorCode, error: unknown): void {
  if (document.getElementById('op2-fatal-error')) return;
  document.exitPointerLock?.();
  const overlay = document.createElement('div'); overlay.id = 'op2-fatal-error';
  overlay.style.cssText = 'position:fixed;inset:0;padding:48px;background:#160e0c;color:#dfbfa8;z-index:99999;overflow:auto';
  overlay.append(errorPanel(code, error)); document.body.append(overlay);
}
