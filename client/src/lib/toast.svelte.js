let seq = 0;
export const toasts = $state([]);

/** show({ text, action: { label, run }, timeout, kind }) */
export function toast(opts) {
  const o = typeof opts === 'string' ? { text: opts } : opts;
  // with a button (undo, restore …) there is more time to decide
  const t = { id: ++seq, timeout: o.action ? 10000 : 5000, kind: 'info', ...o };
  // keep it calm: at most two at a time
  toasts.push(t);
  while (toasts.length > 2) toasts.shift();
  if (t.timeout) setTimeout(() => dismiss(t.id), t.timeout);
  return t.id;
}

export function dismiss(id) {
  const i = toasts.findIndex((t) => t.id === id);
  if (i >= 0) toasts.splice(i, 1);
}

/** Plain notices (no action) from before are done when a dialog opens – they would cover its title. */
export function dismissNotices() {
  for (const t of toasts.filter((x) => !x.action && x.kind !== 'alert')) dismiss(t.id);
}
