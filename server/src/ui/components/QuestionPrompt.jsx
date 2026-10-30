import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { normalizeQuestionSet, FREEFORM_VALUE } from '../../core/question.js';
import { T } from '../theme.js';
import { listWindow, wrapLines } from '../panel.js';
import { Panel } from './Panel.jsx';
import { TYPE_SOMETHING, questionTabs, questionLayout, nextStep, submitSummary, submitLayout } from '../question-view.js';

/**
 * What the agent asks with `ask_question` (v6.4, Claude Code's layout, the
 * owner's pick): tabs across the top when there is more than one question, the
 * question in bold, each option with its description under it, and
 * `Type something.` last. Answers are kept per question, so tab and ←/→ move
 * between them freely and the Submit tab shows them all before they go.
 *
 * The arithmetic is `ui/question-view.js`. Every row truncates: this is drawn
 * in the live frame, where a wrapped row is one nobody charged for.
 */
export function QuestionPrompt({ payload, onAnswer, onCancel, width = 80, rows = 20 }) {
  const questions = normalizeQuestionSet(payload);
  const many = questions.length > 1;
  const [at, setAt] = useState(0);              // a question, or questions.length for Submit
  const [answers, setAnswers] = useState([]);   // by question index
  const [cursor, setCursor] = useState(0);
  const [typing, setTyping] = useState(questions[0].options.length === 0);
  const [draft, setDraft] = useState('');

  const onSubmitTab = many && at === questions.length;
  const current = onSubmitTab ? null : questions[at];
  const items = current
    ? [
      ...current.options.map((o) => ({ label: o.label, value: o.value, description: o.description })),
      { label: TYPE_SOMETHING, value: FREEFORM_VALUE, description: '' },
    ]
    : [];
  const summary = submitSummary(questions, answers);
  const unanswered = summary.findIndex((s) => s.answer == null);
  const submitItems = unanswered === -1
    ? [{ label: 'Submit answers', value: 'submit' }, { label: 'Cancel', value: 'cancel' }]
    : [{ label: `Answer “${questions[unanswered].header}” first`, value: 'goto' }, { label: 'Cancel', value: 'cancel' }];
  const list = onSubmitTab ? submitItems : items;
  const pos = Math.max(0, Math.min(cursor, list.length - 1));

  const go = (to) => {
    setAt(to);
    setCursor(0);
    setDraft('');
    setTyping(to < questions.length && questions[to].options.length === 0);
  };

  const record = (answer) => {
    const next = [...answers];
    next[at] = answer;
    setAnswers(next);
    const step = nextStep(questions, next, at);
    if (step === null) {
      onAnswer([{ question: current.question, answer }]);
      return;
    }
    go(step);
  };

  const choose = (item) => {
    if (onSubmitTab) {
      if (item.value === 'cancel') { onCancel(); return; }
      if (item.value === 'goto') { go(unanswered); return; }
      onAnswer(questions.map((q, i) => ({ question: q.question, answer: answers[i] })));
      return;
    }
    if (item.value === FREEFORM_VALUE) { setTyping(true); return; }
    record(item.value);
  };

  useInput((input, key) => {
    if (key.escape) {
      // Esc backs out of the text field first, then dismisses the whole set.
      if (typing && current?.options.length > 0) { setTyping(false); setDraft(''); return; }
      onCancel();
      return;
    }
    if (typing) return; // the text field has the keyboard
    if (many && (key.tab || key.leftArrow || key.rightArrow)) {
      const back = key.leftArrow || (key.tab && key.shift);
      go((at + (back ? -1 : 1) + questions.length + 1) % (questions.length + 1));
      return;
    }
    if (key.upArrow) { setCursor(pos === 0 ? list.length - 1 : pos - 1); return; }
    if (key.downArrow) { setCursor(pos === list.length - 1 ? 0 : pos + 1); return; }
    if (key.return) { if (list[pos]) choose(list[pos]); return; }
    if (!onSubmitTab && /^[1-9]$/.test(input)) {
      const n = Number(input) - 1;
      if (n < list.length) { setCursor(n); choose(list[n]); }
    }
  });

  // The head: tabs when there are several questions, the header when one.
  const tabs = questionTabs(questions, answers, at);
  const head = many ? (
    <Text wrap="truncate">
      {tabs.map((tab, i) => {
        // `○`, not `☐`: many terminal fonts draw the box small and low, which
        // read as broken (v6.23).
        const mark = tab.submit ? '' : tab.done ? '✔ ' : '○ ';
        // The active tab is one block, mark included; the others keep the
        // mark's own colour. Each is padded the same, so the row does not shift.
        return tab.active ? (
          <Text key={i} bold inverse color={T.menu}>{` ${mark}${tab.label} `}</Text>
        ) : (
          <Text key={i}>
            {' '}<Text color={tab.done ? T.success : T.attention}>{mark}</Text>
            <Text>{tab.label}</Text>{' '}
          </Text>
        );
      })}
    </Text>
  ) : null;

  const keys = typing
    ? `enter submit · esc ${current?.options.length > 0 ? 'back to options' : 'dismiss'}`
    : `↑↓ move · enter choose${many ? ' · tab next question' : ''} · esc cancel`;

  // ── The Submit tab ───────────────────────────────────────────────
  if (onSubmitTab) {
    const fit = submitLayout({ count: summary.length, rows });
    return (
      <Panel width={width} head={head} tight={fit.tight} keys={keys}>
        {fit.heading ? <Text bold wrap="truncate">{' Review your answers'}</Text> : null}
        {fit.inline ? (
          <Text wrap="truncate">
            {'   '}{summary.map((s, i) => (
              <React.Fragment key={i}>
                {i > 0 ? <Text dimColor>{' · '}</Text> : null}
                <Text color={s.answer == null ? T.attention : T.success}>{s.answer == null ? '○ ' : '✔ '}</Text>
                {s.answer ?? <Text color={T.attention}>{s.header}</Text>}
              </React.Fragment>
            ))}
          </Text>
        ) : summary.map((s, i) => (
          <Text key={i} wrap="truncate">
            {'   '}<Text color={s.answer == null ? T.attention : T.success}>{s.answer == null ? '○' : '✔'}</Text>
            {' '}<Text>{`${s.header}:`}</Text>{' '}{s.answer != null ? <Text bold>{s.answer}</Text> : <Text color={T.attention}>not answered</Text>}
          </Text>
        ))}
        {fit.gap ? <Text> </Text> : null}
        {submitItems.map((item, i) => (
          <Text key={item.value} wrap="truncate">
            <Text color={T.accent}>{i === pos ? ' ❯ ' : '   '}</Text>
            <Text color={i === pos ? T.accent : undefined} bold={i === pos}>{item.label}</Text>
          </Text>
        ))}
      </Panel>
    );
  }

  // ── A question ───────────────────────────────────────────────────
  const question = wrapLines(current.question, width - 3, 3);
  const layout = questionLayout({ items, rows, questionLines: question.length });
  const view = listWindow({ count: items.length, cursor: pos, room: layout.room });
  const markers = layout.room >= 3;
  const numWidth = String(Math.min(items.length, 9)).length + 2;
  const labelWidth = layout.under ? 0 : Math.min(28, Math.max(...items.map((it) => it.label.length)));

  return (
    <Panel width={width} head={head} title={current.header} tight={layout.tight} keys={keys}>
      {question.map((line, i) => <Text key={i} bold wrap="truncate">{` ${line}`}</Text>)}
      {layout.tight ? null : <Text> </Text>}
      {view.above && markers ? <Text color={T.muted} wrap="truncate">{`   ↑ ${view.above} more`}</Text> : null}
      {items.slice(view.start, view.end).map((item, k) => {
        const i = view.start + k;
        const sel = i === pos;
        const num = (i < 9 ? `${i + 1}.` : '').padEnd(numWidth);
        if (typing && item.value === FREEFORM_VALUE) {
          return (
            <Box key="typing">
              <Text color={T.accent}>{' ❯ '}{num}</Text>
              <TextInput
                value={draft}
                onChange={setDraft}
                onSubmit={() => {
                  const answer = draft.trim();
                  if (!answer) return; // Enter on an empty field would answer with nothing.
                  record(answer);
                }}
                placeholder="Type your answer"
              />
            </Box>
          );
        }
        const label = layout.under ? item.label : item.label.padEnd(labelWidth);
        return (
          <React.Fragment key={i}>
            <Text wrap="truncate">
              <Text color={T.accent}>{sel ? ' ❯ ' : '   '}</Text>
              <Text color={sel ? T.accent : undefined} dimColor={!sel}>{num}</Text>
              <Text color={sel ? T.accent : undefined} bold={sel}>{label}</Text>
              {!layout.under && item.description ? <Text dimColor>{'  '}{item.description}</Text> : null}
              {answers[at] === item.value ? <Text color={T.success}>{'  ✔'}</Text> : null}
            </Text>
            {layout.under && item.description ? (
              <Text dimColor wrap="truncate">{' '.repeat(3 + numWidth)}{item.description}</Text>
            ) : null}
          </React.Fragment>
        );
      })}
      {view.below && markers ? <Text color={T.muted} wrap="truncate">{`   ↓ ${view.below} more`}</Text> : null}
    </Panel>
  );
}
