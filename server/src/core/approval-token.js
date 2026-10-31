/**
 * A one-use proof that the person said yes to an external write (v8.1).
 *
 * Issued by `external-approval.js` after Send, checked by the tool's handler
 * before it writes. An object, so the model cannot forge one in a tool call's
 * JSON arguments; kept in a WeakSet, so a used or dropped token is gone.
 */
const issued = new WeakSet();

export function issueApproval() {
  const token = Object.freeze({ approved: true });
  issued.add(token);
  return token;
}

/** True once per token, false for anything else. */
export function consumeApproval(token) {
  if (token && typeof token === 'object' && issued.has(token)) {
    issued.delete(token);
    return true;
  }
  return false;
}
