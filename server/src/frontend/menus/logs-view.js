/**
 * The `/logs` picker (v5.35): what the log can answer, each with its answer.
 *
 * `/logs` had seven typed forms — `rates`, `tools`, `notices`, `clear` and a
 * flow name, of which there are nine — and bare `/logs` showed a menu only
 * once something had failed. So "is it slower?" and "how many rounds does a
 * turn take?" were questions you had to know the word for. Every row here
 * carries its one-line answer, so the picker is often the whole reading, and
 * enter opens the full one: the same text the typed form prints.
 *
 * Pure, like `doctor-view.js`: the menu draws what this returns.
 */
import { formatMs } from '../../backend/core/logs/trace-log.js';
import { formatRate } from '../../backend/core/turn/channel-health.js';

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

// `v1 6.0s · v2 5.1s` — shown only with two or more versions: one row
// comparing a thing to itself is noise.
const perVersion = (versions, show) => (versions?.length > 1
  ? ` · ${versions.map((v) => `${v.version} ${show(v)}`).join(', ')}` : '');

/**
 * The picker's rows.
 *
 * @param {{summary, traces, usage, channel}} data — `summarizeErrors`,
 *   `summariseTraces`, `summariseToolUsage` and `channelHealth`, as read now.
 * @returns {Array<{label, detail, value, colour?}>}
 */
export function logsHomeItems({ summary = {}, traces = {}, usage = {}, channel = {} } = {}, { T = {}, time = defaultTime } = {}) {
  const total = summary.total || 0;
  const last = summary.byFlow?.slice().sort((a, b) => new Date(b.last) - new Date(a.last))[0];
  const failures = total
    ? `${plural(total, 'failure')} since cleared · last ${last?.flow || '—'} at ${time(last?.last)}`
    : 'nothing has failed since the log was cleared';

  const complete = traces.stages?.find((s) => s.stage === 'complete');
  const speed = complete
    ? `reply ${formatMs(complete.median)} median, p90 ${formatMs(complete.p90)} · ${plural(complete.n, 'round trip')}`
      + perVersion(traces.versions, (v) => formatMs(v.complete))
    : 'no timings yet — they arrive as turns complete';

  const tools = usage.turns
    ? `${plural(usage.calls || 0, 'call')} over ${plural(usage.turns, 'turn')}`
      + (usage.rounds ? ` · rounds median ${usage.rounds.median}, p90 ${usage.rounds.p90}` : '')
      + perVersion(usage.versions, (v) => (v.rounds ? `${v.rounds.median}` : '—'))
    : 'nothing recorded yet';

  const turns = channel.turns || 0;
  const worst = (channel.rows || []).filter((r) => r.count > 0).sort((a, b) => b.count - a.count)[0];
  const rates = !turns ? 'no turns recorded yet'
    : !channel.total ? `no channel failures in ${plural(turns, 'turn')}`
      : `${plural(channel.total, 'failure')} in ${plural(turns, 'turn')}`
        + (worst ? ` · most: ${worst.label}${channel.enough ? ` ${formatRate(worst.rate)}` : ''}` : '');

  const n = summary.notices?.count || 0;
  const notices = n ? `${plural(n, 'expected state')} — nothing to act on` : 'none logged';

  const items = [
    { label: 'Failures', detail: failures, value: 'failures', ...(total ? { colour: T.danger } : {}) },
    { label: 'Speed', detail: speed, value: 'speed' },
    { label: 'Tools', detail: tools, value: 'tools' },
    { label: 'Text channel', detail: rates, value: 'rates' },
    { label: 'Notices', detail: notices, value: 'notices' },
  ];
  // Only when there is something to clear: a row that deletes nothing is a
  // row someone presses to find out what it does.
  if (total + n > 0) items.push({ label: 'Clear the log', detail: `${plural(total + n, 'entry', 'entries')}`, value: 'clear' });
  return items;
}

/** Failures, one row per flow — enter opens `/logs <flow>`. */
export function failureItems(summary = {}, { T = {}, time = defaultTime } = {}) {
  return (summary.byFlow || []).map((f) => ({
    label: `${String(f.count).padStart(3)}  ${f.flow}`,
    detail: `${f.label} · last ${time(f.last)}`,
    value: f.flow,
    colour: T.danger,
  }));
}

function defaultTime(t) {
  if (!t) return '—';
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
