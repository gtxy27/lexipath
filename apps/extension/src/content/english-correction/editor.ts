type EditableTarget = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

const TEXT_INPUT_TYPES = new Set([
  'text',
  'search',
  'email',
  'url',
  'tel',
  'number',
]);

export function isSupportedEditableTarget(target: EventTarget | null): target is EditableTarget {
  if (!target || !(target instanceof Element)) return false;

  if (target instanceof HTMLTextAreaElement) {
    return !target.disabled && !target.readOnly;
  }

  if (target instanceof HTMLInputElement) {
    if (target.type === 'password') return false;
    if (!TEXT_INPUT_TYPES.has(target.type || 'text')) return false;
    return !target.disabled && !target.readOnly;
  }

  if (target instanceof HTMLElement) {
    if (!target.isContentEditable) return false;
    return true;
  }

  return false;
}

export function getEditableText(target: EditableTarget): string {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return target.value ?? '';
  }
  return target.textContent ?? '';
}

export function setEditableText(target: EditableTarget, nextText: string): void {
  const text = nextText;

  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const start = 0;
    const end = target.value.length;
    target.focus();
    try {
      target.setRangeText(text, start, end, 'end');
    } catch {
      target.value = text;
    }
    target.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  // contenteditable
  target.focus();
  const selection = window.getSelection();
  if (!selection) {
    target.textContent = text;
    target.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  try {
    const range = document.createRange();
    range.selectNodeContents(target);
    selection.removeAllRanges();
    selection.addRange(range);
    const ok = document.execCommand('insertText', false, text);
    if (!ok) {
      target.textContent = text;
      target.dispatchEvent(new Event('input', { bubbles: true }));
    }
  } catch {
    target.textContent = text;
    target.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

