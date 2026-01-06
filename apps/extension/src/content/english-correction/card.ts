import { getI18nMessage } from '../i18n';
import { createLogger, getErrorMessage } from '@lexipath/core/log';

const log = createLogger('english-correction:card');

export type CorrectionCardKind = 'encouragement' | 'corrected' | 'error';

type CardHandle = { close: () => void };

let activeCard: CardHandle | null = null;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function computeCardPosition(anchorRect: DOMRect, cardWidth: number, cardHeight: number): { top: number; left: number } {
  const margin = 10;
  const gap = 10;

  const leftAlign = anchorRect.left;
  const rightAlign = anchorRect.right - cardWidth;

  const maxLeft = window.innerWidth - cardWidth - margin;
  const leftCandidate = clamp(leftAlign, margin, maxLeft);
  const rightCandidate = clamp(rightAlign, margin, maxLeft);
  const leftOverflow = Math.abs(leftAlign - leftCandidate);
  const rightOverflow = Math.abs(rightAlign - rightCandidate);
  const left = leftOverflow <= rightOverflow ? leftCandidate : rightCandidate;

  const belowTop = anchorRect.bottom + gap;
  const aboveTop = anchorRect.top - gap - cardHeight;
  const maxTop = window.innerHeight - cardHeight - margin;

  const hasRoomBelow = belowTop + cardHeight + margin <= window.innerHeight;
  const hasRoomAbove = aboveTop >= margin;
  const preferredTop = hasRoomBelow || !hasRoomAbove ? belowTop : aboveTop;
  const top = clamp(preferredTop, margin, maxTop);
  return { top, left };
}

export function showCorrectionCard(options: {
  kind: CorrectionCardKind;
  message: string;
  anchorRect: DOMRect;
  autoCloseDelayMs?: number;
  showUndo?: boolean;
  onUndo?: () => void;
  theme?: 'light' | 'dark' | 'system';
}): CardHandle {
  if (activeCard) {
    try {
      activeCard.close();
    } catch (error: unknown) {
      log.debug('Failed to close existing correction card; continuing', { message: getErrorMessage(error) });
    }
    activeCard = null;
  }

  const existing = document.getElementById('lexipath-english-correction-card');
  if (existing) existing.remove();

  const container = document.createElement('div');
  container.id = 'lexipath-english-correction-card';
  if (options.theme && options.theme !== 'system') {
    container.dataset.theme = options.theme;
  } else {
    delete container.dataset.theme;
  }
  container.style.position = 'fixed';
  container.style.zIndex = '2147483647';
  container.style.pointerEvents = 'auto';
  container.style.maxWidth = 'calc(100vw - 20px)';
  container.style.width = '320px';
  container.style.boxSizing = 'border-box';
  container.style.opacity = '0';
  container.style.transform = 'translateY(8px)';
  container.style.transition = 'opacity 140ms ease, transform 140ms ease';

  const shadow = container.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host {
      --lp-ec-bg: rgba(255, 255, 255, 0.96);
      --lp-ec-fg: rgba(15, 23, 42, 0.92);
      --lp-ec-muted: rgba(71, 85, 105, 0.9);
      --lp-ec-border: rgba(148, 163, 184, 0.45);
      --lp-ec-shadow: 0 10px 30px rgba(15, 23, 42, 0.18);
      --lp-ec-btn-bg: rgba(248, 250, 252, 0.9);
      --lp-ec-btn-bg-hover: rgba(241, 245, 249, 0.95);
      --lp-ec-btn-border: rgba(148, 163, 184, 0.5);
      --lp-ec-primary-border: rgba(99, 102, 241, 0.5);
      --lp-ec-primary-bg: rgba(99, 102, 241, 0.12);
      --lp-ec-primary-bg-hover: rgba(99, 102, 241, 0.18);
    }

    @media (prefers-color-scheme: dark) {
      :host {
        --lp-ec-bg: rgba(15, 23, 42, 0.92);
        --lp-ec-fg: rgba(241, 245, 249, 0.96);
        --lp-ec-muted: rgba(226, 232, 240, 0.75);
        --lp-ec-border: rgba(148, 163, 184, 0.35);
        --lp-ec-shadow: 0 10px 30px rgba(0,0,0,0.35);
        --lp-ec-btn-bg: rgba(30, 41, 59, 0.7);
        --lp-ec-btn-bg-hover: rgba(30, 41, 59, 0.9);
        --lp-ec-btn-border: rgba(148, 163, 184, 0.35);
        --lp-ec-primary-border: rgba(99, 102, 241, 0.45);
        --lp-ec-primary-bg: rgba(99, 102, 241, 0.18);
        --lp-ec-primary-bg-hover: rgba(99, 102, 241, 0.26);
      }
    }

    :host([data-theme="light"]) {
      --lp-ec-bg: rgba(255, 255, 255, 0.96);
      --lp-ec-fg: rgba(15, 23, 42, 0.92);
      --lp-ec-muted: rgba(71, 85, 105, 0.9);
      --lp-ec-border: rgba(148, 163, 184, 0.45);
      --lp-ec-shadow: 0 10px 30px rgba(15, 23, 42, 0.18);
      --lp-ec-btn-bg: rgba(248, 250, 252, 0.9);
      --lp-ec-btn-bg-hover: rgba(241, 245, 249, 0.95);
      --lp-ec-btn-border: rgba(148, 163, 184, 0.5);
      --lp-ec-primary-border: rgba(99, 102, 241, 0.5);
      --lp-ec-primary-bg: rgba(99, 102, 241, 0.12);
      --lp-ec-primary-bg-hover: rgba(99, 102, 241, 0.18);
    }

    :host([data-theme="dark"]) {
      --lp-ec-bg: rgba(15, 23, 42, 0.92);
      --lp-ec-fg: rgba(241, 245, 249, 0.96);
      --lp-ec-muted: rgba(226, 232, 240, 0.75);
      --lp-ec-border: rgba(148, 163, 184, 0.35);
      --lp-ec-shadow: 0 10px 30px rgba(0,0,0,0.35);
      --lp-ec-btn-bg: rgba(30, 41, 59, 0.7);
      --lp-ec-btn-bg-hover: rgba(30, 41, 59, 0.9);
      --lp-ec-btn-border: rgba(148, 163, 184, 0.35);
      --lp-ec-primary-border: rgba(99, 102, 241, 0.45);
      --lp-ec-primary-bg: rgba(99, 102, 241, 0.18);
      --lp-ec-primary-bg-hover: rgba(99, 102, 241, 0.26);
    }

    .card {
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
      border-radius: 14px;
      padding: 12px 12px 10px;
      border: 1px solid var(--lp-ec-border);
      background: var(--lp-ec-bg);
      color: var(--lp-ec-fg);
      box-shadow: var(--lp-ec-shadow);
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
      border: 1px solid var(--lp-ec-btn-border);
      background: var(--lp-ec-btn-bg);
      color: var(--lp-ec-fg);
      border-radius: 10px;
      padding: 6px 10px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }
    button:hover { background: var(--lp-ec-btn-bg-hover); }
    .primary {
      border-color: var(--lp-ec-primary-border);
      background: var(--lp-ec-primary-bg);
    }
    .primary:hover { background: var(--lp-ec-primary-bg-hover); }
    .tone {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--lp-ec-muted);
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
      ? getI18nMessage('englishCorrection_tagCorrected', undefined, 'englishCorrection_tagCorrected')
      : options.kind === 'error'
        ? getI18nMessage('englishCorrection_tagError', undefined, 'englishCorrection_tagError')
        : getI18nMessage('englishCorrection_tagEncouragement', undefined, 'englishCorrection_tagEncouragement');
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
    undo.textContent = getI18nMessage('englishCorrection_undo', undefined, 'englishCorrection_undo');
    undo.addEventListener('click', () => {
      options.onUndo?.();
      close();
    });
    footer.appendChild(undo);
  }

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = getI18nMessage('englishCorrection_close', undefined, 'englishCorrection_close');
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

  requestAnimationFrame(() => {
    container.style.opacity = '1';
    container.style.transform = 'translateY(0px)';
  });

  let autoCloseTimer: number | null = null;
  if (typeof options.autoCloseDelayMs === 'number' && options.autoCloseDelayMs > 0) {
    autoCloseTimer = window.setTimeout(() => close(), options.autoCloseDelayMs);
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing) return;
    if (event.key === 'Escape') {
      if (options.kind === 'corrected' && options.showUndo && options.onUndo) {
        options.onUndo();
      }
      close();
      return;
    }
    if (event.key === 'Enter') {
      close();
    }
  };
  document.addEventListener('keydown', onKeyDown, true);

  let closing = false;
  function close() {
    if (closing) return;
    closing = true;

    if (autoCloseTimer !== null) {
      window.clearTimeout(autoCloseTimer);
      autoCloseTimer = null;
    }

    document.removeEventListener('keydown', onKeyDown, true);
    if (activeCard && activeCard.close === close) {
      activeCard = null;
    }

    container.style.opacity = '0';
    container.style.transform = 'translateY(8px)';

    window.setTimeout(() => {
      container.remove();
    }, 180);
  }

  const handle = { close };
  activeCard = handle;
  return handle;
}
