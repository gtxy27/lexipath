import { getI18nMessage } from '../i18n';

export type CorrectionCardKind = 'encouragement' | 'corrected' | 'error';

type CardHandle = { close: () => void };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function computeCardPosition(anchorRect: DOMRect, cardWidth: number, cardHeight: number): { top: number; left: number } {
  const margin = 10;
  const preferredLeft = anchorRect.left;
  const preferredTop = anchorRect.bottom + 10;

  const left = clamp(preferredLeft, margin, window.innerWidth - cardWidth - margin);
  const top = clamp(preferredTop, margin, window.innerHeight - cardHeight - margin);
  return { top, left };
}

export function showCorrectionCard(options: {
  kind: CorrectionCardKind;
  message: string;
  anchorRect: DOMRect;
  autoCloseDelayMs?: number;
  showUndo?: boolean;
  onUndo?: () => void;
}): CardHandle {
  const existing = document.getElementById('lexipath-english-correction-card');
  if (existing) existing.remove();

  const container = document.createElement('div');
  container.id = 'lexipath-english-correction-card';
  container.style.position = 'fixed';
  container.style.zIndex = '2147483647';
  container.style.pointerEvents = 'auto';
  container.style.maxWidth = 'calc(100vw - 20px)';
  container.style.width = '320px';
  container.style.boxSizing = 'border-box';

  const shadow = container.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    .card {
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
      border-radius: 12px;
      padding: 12px 12px 10px;
      border: 1px solid rgba(148, 163, 184, 0.35);
      background: rgba(15, 23, 42, 0.95);
      color: rgba(241, 245, 249, 0.96);
      box-shadow: 0 10px 30px rgba(0,0,0,0.35);
      backdrop-filter: blur(8px);
    }
    .message {
      font-size: 13px;
      line-height: 1.45;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .footer {
      margin-top: 10px;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    button {
      appearance: none;
      border: 1px solid rgba(148, 163, 184, 0.35);
      background: rgba(30, 41, 59, 0.7);
      color: rgba(241, 245, 249, 0.95);
      border-radius: 10px;
      padding: 6px 10px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }
    button:hover { background: rgba(30, 41, 59, 0.9); }
    .primary {
      border-color: rgba(99, 102, 241, 0.45);
      background: rgba(99, 102, 241, 0.18);
    }
    .primary:hover { background: rgba(99, 102, 241, 0.26); }
    .tone {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: rgba(226, 232, 240, 0.75);
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: rgba(99, 102, 241, 0.85);
    }
    .dot.corrected { background: rgba(16, 185, 129, 0.9); }
    .dot.error { background: rgba(239, 68, 68, 0.9); }
  `;
  shadow.appendChild(style);

  const card = document.createElement('div');
  card.className = 'card';
  const tone = document.createElement('div');
  tone.className = 'tone';
  const dot = document.createElement('span');
  dot.className = `dot ${options.kind}`;
  const toneText = document.createElement('span');
  toneText.textContent =
    options.kind === 'corrected'
      ? getI18nMessage('englishCorrection_tagCorrected')
      : options.kind === 'error'
        ? getI18nMessage('englishCorrection_tagError')
        : getI18nMessage('englishCorrection_tagEncouragement');
  tone.appendChild(dot);
  tone.appendChild(toneText);
  card.appendChild(tone);

  const message = document.createElement('div');
  message.className = 'message';
  message.textContent = options.message;
  card.appendChild(message);

  const footer = document.createElement('div');
  footer.className = 'footer';

  if (options.showUndo && options.onUndo) {
    const undo = document.createElement('button');
    undo.className = 'primary';
    undo.type = 'button';
    undo.textContent = getI18nMessage('englishCorrection_undo');
    undo.addEventListener('click', () => {
      options.onUndo?.();
      close();
    });
    footer.appendChild(undo);
  }

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = getI18nMessage('englishCorrection_close');
  closeBtn.addEventListener('click', () => close());
  footer.appendChild(closeBtn);

  card.appendChild(footer);
  shadow.appendChild(card);

  document.documentElement.appendChild(container);

  // Position after mount to get height
  const rect = card.getBoundingClientRect();
  const pos = computeCardPosition(options.anchorRect, rect.width || 320, rect.height || 120);
  container.style.left = `${pos.left}px`;
  container.style.top = `${pos.top}px`;

  let autoCloseTimer: number | null = null;
  if (typeof options.autoCloseDelayMs === 'number' && options.autoCloseDelayMs > 0) {
    autoCloseTimer = window.setTimeout(() => close(), options.autoCloseDelayMs);
  }

  function close() {
    if (autoCloseTimer !== null) {
      window.clearTimeout(autoCloseTimer);
      autoCloseTimer = null;
    }
    container.remove();
  }

  return { close };
}

