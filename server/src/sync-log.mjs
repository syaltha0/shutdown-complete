// Diagnostics contain no transport messages, addresses or credentials.
export const SYNC_HISTORY_LIMIT = 10;
export const syncText = value => String(value ?? '').replace(/(?:https?:\/\/|www\.)\S+/gi, '[redacted]').replace(/[\r\n\t]/g, ' ').slice(0, 80);
export function countSyncOperation(list, operation) {
  if (!['received', 'sent', 'deleted', 'skipped'].includes(operation)) throw new Error('operation');
  list[operation]++;
}
export const newSyncRun = () => ({ at: new Date().toISOString(), durationMs: 0, ok: false, lists: [], errors: [] });
const reasons = new Set(['auth', 'conflict', 'failed', 'private', 'unreachable', 'url', 'no-caldav', 'report', 'mkcalendar', 'busy']);
export function finishSyncRun(history, run, durationMs, secrets = []) {
  const redact = value => syncText(secrets.filter(Boolean).reduce((text, secret) => text.split(secret).join('[redacted]'), String(value ?? '')));
  const clean = { ...run, durationMs, lists: run.lists.map(l => ({ ...l, name: redact(l.name) })), error: run.error ? (reasons.has(run.error) ? run.error : 'failed') : null,
    errors: run.errors.slice(0, 100).map(e => ({ ...e, title: redact(e.title), reason: reasons.has(e.reason) ? e.reason : 'failed' })) };
  return [clean, ...(history ?? [])].slice(0, SYNC_HISTORY_LIMIT);
}
