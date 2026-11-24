import { BUILD } from '../net/build';
import { TURN_URL } from '../net/turn';
import { ERRORS, type ErrorCode } from './errors';

const OPT_OUT = 'op2.reports.disabled';
const HISTORY = 'op2.reports.history';
export interface ReportEvent {
  session: string; at: number; build: string; mode: string; role: 'host' | 'guest' | 'solo'; lobby: string;
  browser: string; os: string; memory: string; code: ErrorCode; message: string; stack: string; detail: string;
}
export interface ReportDetail { error?: unknown; stage?: string; reason?: string; durationMs?: number; ice?: string }
interface Options {
  url: string; storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>; send?: (body: string) => boolean | Promise<unknown>;
  now?: () => number; session?: string; max?: number; batch?: number;
}
/** Only technical call sites belong here: never pass player text, lobby codes, credentials or candidate addresses. */
export function scrub(value: unknown, max = 800): string {
  return String(value ?? '').replace(/https?:\/\/[^\s)]+/g, raw => {
    try { return new URL(raw).pathname.split('/').filter(Boolean).slice(-2).join('/'); } catch { return '[url]'; }
  })
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip]')
    .replace(/\b[\da-f]{0,4}(?::[\da-f]{0,4})*::(?:[\da-f]{0,4}:)*[\da-f]{0,4}\b|\b(?:[\da-f]{1,4}:){7}[\da-f]{1,4}\b/gi, '[ip]')
    .replace(/(?:password|credential|token|lobby|code)\s*[=:]\s*\S+/gi, '[redacted]')
    .replace(/\b[A-HJKMNP-Z2-9]{6}\b/g, '[code]')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, max);
}
export function environment(ua = globalThis.navigator?.userAgent ?? '') {
  const browser = /Firefox\//.test(ua) ? 'Firefox' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chromium' : /Safari\//.test(ua) ? 'Safari' : 'Other';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Other';
  const memory = (globalThis.navigator as Navigator & { deviceMemory?: number })?.deviceMemory;
  return { browser, os, memory: memory ? memory <= 4 ? 'low' : memory <= 8 ? 'medium' : 'high' : 'unknown' };
}

export function createReporter(options: Options) {
  const now = options.now ?? Date.now;
  let enabled = true;
  try { enabled = options.storage?.getItem(OPT_OUT) !== '1'; } catch { /* private browsing */ }
  const session = options.session ?? globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  let context: Pick<ReportEvent, 'mode' | 'role' | 'lobby'> = { mode: 'crucible', role: 'solo', lobby: '' };
  let count = 0;
  let pending: ReportEvent[] = [];
  let history: ReportEvent[] = [];
  if (enabled && options.url) {
    try {
      const saved: unknown = JSON.parse(options.storage?.getItem(HISTORY) ?? '[]');
      if (Array.isArray(saved)) history = saved.filter(e => e && typeof e === 'object' && e.code in ERRORS && typeof e.session === 'string').slice(-50);
    } catch { /* corrupt or unavailable storage */ }
  }
  const seen = new Map<string, number>();
  const persist = () => { try { options.storage?.setItem(HISTORY, JSON.stringify(history)); } catch { /* quota, disabled storage */ } };
  const api = {
    enabled: () => enabled,
    beginAttempt() { seen.clear(); },
    setEnabled(value: boolean) {
      enabled = value;
      if (!value) { pending = []; history = []; }
      try { options.storage?.setItem(OPT_OUT, value ? '0' : '1'); if (!value) options.storage?.removeItem(HISTORY); } catch { /* fine */ }
    },
    context(value: Partial<typeof context>) { context = { ...context, ...value }; },
    report(code: ErrorCode, detail: ReportDetail = {}) {
      try {
        if (!options.url || !enabled || count >= (options.max ?? 150) || !ERRORS[code]) return;
        const error = detail.error as { stack?: string; message?: string } | undefined;
        const technical = scrub([detail.stage, detail.reason, detail.durationMs === undefined ? '' : `loadMs=${Math.round(detail.durationMs)}`, detail.ice].filter(Boolean).join('; '), 300);
        // Stack header may contain arbitrary exception data. Keep frames only; catalog supplies the message.
        const stack = scrub(error?.stack?.split('\n').slice(1, 7).join('\n'), 800);
        const key = `${code}|${technical}|${stack}`;
        if (seen.has(key) && now() - seen.get(key)! < 60_000) return;
        seen.set(key, now()); count++;
        const event: ReportEvent = { session, at: now(), build: BUILD, ...context, ...environment(), code, message: ERRORS[code][0], stack, detail: technical };
        pending.push(event); history = [...history, event].slice(-50); persist();
      } catch { /* reporting must never break the game */ }
    },
    flush() {
      try {
        if (!enabled || !options.url || !pending.length || !options.send) return;
        // At most five events, also bounded by encoded bytes for non-ASCII stacks.
        const batch = pending.splice(0, Math.min(options.batch ?? 5, 5));
        while (batch.length > 1 && new TextEncoder().encode(JSON.stringify({ events: batch })).byteLength > 8192) pending.unshift(batch.pop()!);
        const result = options.send(JSON.stringify({ events: batch }));
        if (result && typeof (result as Promise<unknown>).catch === 'function') void (result as Promise<unknown>).catch(() => {});
      } catch { /* bounded, best effort: never retry an outage forever */ }
    },
    copyText() { return JSON.stringify({ build: BUILD, ...context, ...environment(), events: history }, null, 2); },
    events: () => history.slice(),
  };
  return api;
}
let storage: Storage | undefined;
try { storage = globalThis.localStorage; } catch { /* disabled */ }
export const reporter = createReporter({ url: TURN_URL, storage, send(body) {
  const url = `${TURN_URL.replace(/\/$/, '')}/log`;
  if (globalThis.navigator?.sendBeacon?.(url, new Blob([body], { type: 'text/plain' }))) return true;
  return globalThis.fetch?.(url, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain' }, credentials: 'omit', referrerPolicy: 'no-referrer' });
} });
export const report = reporter.report;
let lobbyGeneration = 0;
/** A digest pairs both sides without sending the invite code. Old async results cannot label a newer attempt. */
export async function reportLobby(code: string, role: 'host' | 'guest'): Promise<void> {
  const generation = ++lobbyGeneration;
  reporter.context({ role, lobby: '' });
  reporter.beginAttempt();
  try {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`op2:${code}`));
    if (generation === lobbyGeneration) reporter.context({ lobby: Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('') });
  } catch { /* no secure context */ }
}
export function reportSolo(): void { ++lobbyGeneration; reporter.context({ role: 'solo', lobby: '' }); }
export function startReporting(): void {
  if (typeof window === 'undefined') return;
  const mode = new URLSearchParams(location.search).get('contract') ?? 'crucible';
  reporter.context({ mode: ['crucible', 'outpost', 'rooftop', 'badlands', 'dogfight', 'defense', 'campaign', 'foreclosure'].includes(mode) ? mode : 'crucible' });
  setInterval(() => reporter.flush(), 5000);
  window.addEventListener('pagehide', () => { for (let i = 0; i < 30; i++) reporter.flush(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) reporter.flush(); });
}
