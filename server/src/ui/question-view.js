/**
 * The question prompt's arithmetic (`components/QuestionPrompt.jsx`), pure so
 * it is tested without Ink.
 *
 * v6.4, the owner's pick from mockups: Claude Code's own picker. Tabs of the
 * questions across the top (`☐` until answered, then `✔`) and a Submit tab;
 * the question in bold; each option's description on the line under it; and
 * `Type something.` last.
 *
 * An option with its description costs two rows, so the descriptions are what
 * gives way on a short terminal — first moved beside the label as a dim
 * column, then the list scrolls. An option is never dropped for a description.
 */

export const TYPE_SOMETHING = 'Type something.';

/** The tab row: one tab per question, then Submit. Only when there is more than one. */
export function questionTabs(questions, answers, at) {
  if (questions.length < 2) return [];
  const tabs = questions.map((q, i) => ({
    label: q.header,
    done: answers[i] != null,
    active: i === at,
  }));
  tabs.push({ label: 'Submit', done: false, active: at === questions.length, submit: true });
  return tabs;
}

/**
 * How the options fit in `rows`.
 *
 * Furniture: the rule, the head (tabs or title), a gap above and below the body
 * unless tight, the keys line, the question's lines and — unless tight — the
 * gap under them. Tight is a menu opened mid-turn on a short terminal (about
 * six rows at 13), where every gap is an option not shown.
 *
 * @returns {{tight: boolean, under: boolean, room: number}} `under` is whether
 *   descriptions go on their own line; `room` is how many option rows the list
 *   may draw (as `listWindow`'s room when it is less than the count)
 */
export function questionLayout({ items = [], rows = 20, questionLines = 1 } = {}) {
  const tight = rows < 12;
  const furniture = 2 + (tight ? 0 : 2) + 1 + questionLines + (tight ? 0 : 1);
  const space = Math.max(1, rows - furniture);
  const twoRow = items.reduce((n, it) => n + (it.description ? 2 : 1), 0);
  if (twoRow <= space) return { tight, under: true, room: items.length };
  return { tight, under: false, room: Math.min(items.length, space) };
}

/**
 * Where enter on a question goes next: the next unanswered question after this
 * one, wrapping, else the Submit tab. A single question has no Submit tab and
 * answers at once (`null`).
 */
export function nextStep(questions, answers, at) {
  if (questions.length < 2) return null;
  for (let k = 1; k <= questions.length; k++) {
    const i = (at + k) % questions.length;
    if (answers[i] == null) return i;
  }
  return questions.length;
}

/** The Submit tab's rows: what each question was answered with. */
export function submitSummary(questions, answers) {
  return questions.map((q, i) => ({ header: q.header, answer: answers[i] ?? null }));
}

/**
 * The Submit tab in `rows`: the review heading and the gap above the choices
 * go first; then, when the answers cannot each have a row, they share one
 * (`inline`) — a `+3 more` row at 13 rows hid every answer it was there to
 * show. The two choices always show.
 *
 * @returns {{tight: boolean, heading: boolean, gap: boolean, inline: boolean}}
 */
export function submitLayout({ count = 0, rows = 20 } = {}) {
  const tight = rows < 12;
  const base = 2 + (tight ? 0 : 2) + 1 + 2; // rule, head, gaps, keys, the two choices
  let space = Math.max(0, rows - base);
  const heading = space >= count + 2;
  if (heading) space -= 1;
  const gap = space >= count + 1;
  if (gap) space -= 1;
  return { tight, heading, gap, inline: count > space };
}
