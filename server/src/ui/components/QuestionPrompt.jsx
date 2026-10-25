import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { normalizeQuestionSet, FREEFORM_VALUE } from '../../core/question.js';
import { T } from '../theme.js';
import { panelRoom, wrapLines } from '../panel.js';
import { Panel, Choices } from './Panel.jsx';

/**
 * The agent's `ask_question` prompt.
 *
 * Four things the old picker lacked and the agent loop needed: a way to answer
 * something the model didn't think of, a way to decline (the loop blocks on
 * `pendingQuestionResolve`, so "no answer" used to mean "hang"), the
 * description of whatever option is under the cursor, and more than one
 * question per prompt — three questions used to cost three round trips through
 * the browser tab.
 *
 * InputBar hides itself whenever a menu is up, so this owns the keyboard while
 * it is mounted and there is no second useInput competing for the same keys.
 */
export function QuestionPrompt({ payload, onAnswer, onCancel, width = 80, rows = 20 }) {
  const questions = normalizeQuestionSet(payload);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState([]);
  const current = questions[step];
  // With no usable options there is nothing to pick, so go straight to typing.
  const [typing, setTyping] = useState(current.options.length === 0);
  const [draft, setDraft] = useState('');
  const [highlighted, setHighlighted] = useState(null);

  useInput((input, key) => {
    if (!key.escape) return;
    // Esc backs out of the text field first, then dismisses the whole batch.
    if (typing && current.options.length > 0) {
      setTyping(false);
      setDraft('');
      return;
    }
    onCancel();
  });

  const record = (answer) => {
    const next = [...answers, { question: current.question, answer }];
    if (step + 1 >= questions.length) {
      onAnswer(next);
      return;
    }
    setAnswers(next);
    setStep(step + 1);
    setTyping(questions[step + 1].options.length === 0);
    setDraft('');
    setHighlighted(null);
  };

  // Numbered, as Claude Code asks: a digit answers. The text field takes over
  // the keyboard when "Something else" is chosen, so a digit typed there is
  // text, not a choice.
  const items = [
    ...current.options.map((option, i) => ({
      key: `opt-${i}`,
      label: option.label,
      value: option.value,
      description: option.description,
    })),
    { key: 'freeform', label: 'Something else…', value: FREEFORM_VALUE, description: 'Type your own answer.' },
  ];

  const active = highlighted ?? items[0];
  // The question, then what is already answered, then the description line.
  const question = wrapLines(current.question, width - 3, 3);
  const { tight, room } = panelRoom({ rows, width, extra: question.length + answers.length + 2 });

  return (
    <Panel width={width} tight={tight}
      title={current.header}
      status={questions.length > 1 ? `${step + 1} of ${questions.length}` : null}
      keys={typing
        ? `enter submit · esc ${current.options.length > 0 ? 'back to options' : 'dismiss'}`
        : `↑↓ move · 1–${Math.min(9, items.length)} or enter select · esc dismiss`}>
      {question.map((line, i) => <Text key={i} wrap="truncate">{` ${line}`}</Text>)}

      {/* What has already been answered, so the batch reads as one exchange. */}
      {answers.map((entry, i) => (
        <Text key={`a${i}`} dimColor wrap="truncate">{' '}<Text color={T.success}>✔</Text>{` ${entry.answer}`}</Text>
      ))}
      <Text> </Text>

      {!typing && (
        <>
          <Choices
            key={step}
            numbered
            limit={room}
            items={items}
            onHighlight={(item) => setHighlighted(item)}
            onSelect={(item) => {
              if (item.value === FREEFORM_VALUE) {
                setTyping(true);
                return;
              }
              record(item.value);
            }}
          />
          <Text dimColor wrap="truncate">{active?.description ? `   ↳ ${active.description}` : ' '}</Text>
        </>
      )}

      {typing && (
        <>
          <Box>
            <Text color={T.accent}>{' ❯ '}</Text>
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
          <Text> </Text>
        </>
      )}
    </Panel>
  );
}
