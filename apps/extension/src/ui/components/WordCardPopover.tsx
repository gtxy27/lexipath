import React, { useEffect, useRef, useState, useCallback } from 'react';
import browser from 'webextension-polyfill';
import { WordCard, type WordCardData } from './WordCard';
import { sendMessage } from '../../shared/messages';

export interface WordCardPopoverProps {
  word: string;
  anchorRect: DOMRect;
  mode?: 'hover' | 'click';
  onClose: () => void;
  onFavoriteToggle?: (word: string, isFavorited: boolean) => void;
  onLearnedToggle?: (word: string, isLearned: boolean) => void;
}

interface Position {
  top: number;
  left: number;
}

function resolveTtsLang(options: { targetLanguage?: string; nativeLanguage?: string }): string {
  switch (options.targetLanguage) {
    case 'en':
      return 'en-US';
    case 'ja':
      return 'ja-JP';
    case 'ko':
      return 'ko-KR';
    case 'fr':
      return 'fr-FR';
    case 'de':
      return 'de-DE';
    case 'zh':
      return options.nativeLanguage === 'zh-TW' ? 'zh-TW' : 'zh-CN';
    default:
      return 'en-US';
  }
}

function t(key: string, substitutions?: string | string[]): string {
  try {
    const message = browser.i18n.getMessage(key, substitutions as any);
    return message || key;
  } catch {
    return key;
  }
}

export function WordCardPopover({
  word,
  anchorRect,
  mode = 'click',
  onClose,
  onFavoriteToggle,
  onLearnedToggle,
}: WordCardPopoverProps): React.ReactElement {
  const [cardData, setCardData] = useState<WordCardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [ttsLang, setTtsLang] = useState<string>('en-US');
  const [position, setPosition] = useState<Position>({ top: 0, left: 0 });
  const [isVisible, setIsVisible] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeTimeoutRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      try {
        const response = await sendMessage('GET_SETTINGS', undefined);
        if (!response.ok || cancelled) return;
        setTtsLang(resolveTtsLang(response.value));
      } catch {
        // ignore
      }
    }

    loadSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch word explanation
  useEffect(() => {
    let cancelled = false;

    async function fetchWordData() {
      setIsLoading(true);
      try {
        const response = await sendMessage('EXPLAIN_WORD', { word });
        if (cancelled) return;

        if (response.ok) {
          const data = response.value as {
            word: string;
            phonetic?: string;
            definition: string;
            difficulty?: string;
          };
          setCardData({
            word: data.word || word,
            ...(data.phonetic ? { phonetic: data.phonetic } : {}),
            definition: data.definition || t('wordCard_definitionUnavailable'),
            ...(data.difficulty ? { difficulty: data.difficulty } : {}),
          });
        } else {
          console.error('[WordCardPopover] Failed to fetch word data:', response.error);
          setCardData({
            word,
            definition: t('wordCard_definitionFailed'),
          });
        }
      } catch (error) {
        if (cancelled) return;
        console.error('[WordCardPopover] Error fetching word data:', error);
        setCardData({
          word,
          definition: t('wordCard_definitionError'),
        });
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchWordData();

    return () => {
      cancelled = true;
    };
  }, [word]);

  // Calculate position
  useEffect(() => {
    if (!popoverRef.current) return;

    const popoverRect = popoverRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const MARGIN = 8;
    const PREFERRED_OFFSET = 10;

    let top = anchorRect.bottom + PREFERRED_OFFSET;
    let left = anchorRect.left + anchorRect.width / 2 - popoverRect.width / 2;

    // Adjust horizontal position if it overflows
    if (left < MARGIN) {
      left = MARGIN;
    } else if (left + popoverRect.width > viewportWidth - MARGIN) {
      left = viewportWidth - popoverRect.width - MARGIN;
    }

    // Adjust vertical position if it overflows (show above instead)
    if (top + popoverRect.height > viewportHeight - MARGIN) {
      top = anchorRect.top - popoverRect.height - PREFERRED_OFFSET;
    }

    // Ensure it doesn't go above viewport
    if (top < MARGIN) {
      top = MARGIN;
    }

    setPosition({ top, left });

    // Trigger animation after position is calculated
    requestAnimationFrame(() => {
      setIsVisible(true);
    });
  }, [anchorRect, cardData]);

  // Handle click outside to close
  useEffect(() => {
    if (mode !== 'click') return;

    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        onClose();
      }
    }

    // Add listener after a small delay to avoid immediate close
    const timeout = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timeout);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [mode, onClose]);

  // Handle hover mode
  const handleMouseEnter = useCallback(() => {
    if (mode === 'hover' && closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = undefined;
    }
  }, [mode]);

  const handleMouseLeave = useCallback(() => {
    if (mode === 'hover') {
      closeTimeoutRef.current = setTimeout(() => {
        onClose();
      }, 300);
    }
  }, [mode, onClose]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div
      ref={popoverRef}
      className={`fixed z-[10000] transition-opacity duration-200 ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {isLoading ? (
        <div className="bg-white rounded-lg shadow-lg p-4 min-w-[280px]">
          <div className="flex items-center justify-center py-4">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-500"></div>
          </div>
        </div>
      ) : cardData ? (
        <WordCard
          data={cardData}
          mode={mode}
          ttsLang={ttsLang}
          {...(onFavoriteToggle ? { onFavoriteToggle } : {})}
          {...(onLearnedToggle ? { onLearnedToggle } : {})}
          onClose={onClose}
        />
      ) : null}
    </div>
  );
}
