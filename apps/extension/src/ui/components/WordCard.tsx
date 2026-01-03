import React, { useCallback, useState } from 'react';
import browser from 'webextension-polyfill';
import { speak, stop } from '@lexipath/dictionary';

export interface WordCardData {
  word: string;
  phonetic?: string;
  definition: string;
  difficulty?: string;
  isFavorited?: boolean;
  isLearned?: boolean;
}

export interface WordCardProps {
  data: WordCardData;
  mode?: 'hover' | 'click';
  ttsLang?: string;
  onFavoriteToggle?: (word: string, isFavorited: boolean) => void;
  onLearnedToggle?: (word: string, isLearned: boolean) => void;
  onClose?: () => void;
}

export function WordCard({
  data,
  mode = 'click',
  ttsLang,
  onFavoriteToggle,
  onLearnedToggle,
  onClose,
}: WordCardProps): React.ReactElement {
  const [isFavorited, setIsFavorited] = useState(data.isFavorited ?? false);
  const [isLearned, setIsLearned] = useState(data.isLearned ?? false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);

  const handleSpeak = useCallback(async () => {
    if (isPlayingAudio) {
      stop();
      setIsPlayingAudio(false);
      return;
    }

    try {
      setIsPlayingAudio(true);
      await speak(data.word, ttsLang ?? 'en-US');
    } catch (error) {
      console.error('[WordCard] TTS error:', error);
    } finally {
      setIsPlayingAudio(false);
    }
  }, [data.word, isPlayingAudio, ttsLang]);

  const handleFavoriteToggle = useCallback(() => {
    const nextValue = !isFavorited;
    setIsFavorited(nextValue);
    onFavoriteToggle?.(data.word, nextValue);
  }, [data.word, isFavorited, onFavoriteToggle]);

  const handleLearnedToggle = useCallback(() => {
    const nextValue = !isLearned;
    setIsLearned(nextValue);
    onLearnedToggle?.(data.word, nextValue);
  }, [data.word, isLearned, onLearnedToggle]);

  const getDifficultyColor = (difficulty?: string): string => {
    if (!difficulty) return 'bg-gray-100 text-gray-600';
    const lower = difficulty.toLowerCase();
    if (lower.includes('easy') || lower === 'a1' || lower === 'a2') {
      return 'bg-green-100 text-green-700';
    }
    if (lower.includes('medium') || lower === 'b1' || lower === 'b2') {
      return 'bg-yellow-100 text-yellow-700';
    }
    if (lower.includes('hard') || lower === 'c1' || lower === 'c2') {
      return 'bg-red-100 text-red-700';
    }
    return 'bg-gray-100 text-gray-600';
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-4 min-w-[280px] max-w-[400px]">
      {/* Header: Word and Close Button */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <h3 className="text-xl font-bold text-gray-900">{data.word}</h3>
          {data.phonetic && (
            <p className="text-sm text-gray-500 mt-1">{data.phonetic}</p>
          )}
        </div>
        {mode === 'click' && onClose && (
          <button
            onClick={() => {
              stop();
              onClose();
            }}
            className="text-gray-400 hover:text-gray-600 ml-2 p-1"
            aria-label={browser.i18n.getMessage('wordCard_close')}
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
      </div>

      {/* Difficulty Badge */}
      {data.difficulty && (
        <div className="mb-3">
          <span
            className={`inline-block px-2 py-1 text-xs font-medium rounded ${getDifficultyColor(
              data.difficulty
            )}`}
          >
            {data.difficulty}
          </span>
        </div>
      )}

      {/* Definition */}
      <div className="mb-4">
        <p className="text-sm text-gray-700 leading-relaxed">{data.definition}</p>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
        <button
          onClick={handleSpeak}
          disabled={isPlayingAudio}
          className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          aria-label={browser.i18n.getMessage('wordCard_pronounce')}
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
            />
          </svg>
          <span>{browser.i18n.getMessage('wordCard_pronounce')}</span>
        </button>

        <button
          onClick={handleFavoriteToggle}
          className={`flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded transition-colors ${
            isFavorited
              ? 'text-yellow-700 bg-yellow-100 hover:bg-yellow-200'
              : 'text-gray-700 bg-gray-100 hover:bg-gray-200'
          }`}
          aria-label={browser.i18n.getMessage('wordCard_favorite')}
        >
          <svg
            className="w-4 h-4"
            fill={isFavorited ? 'currentColor' : 'none'}
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
            />
          </svg>
        </button>

        <button
          onClick={handleLearnedToggle}
          className={`flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded transition-colors ${
            isLearned
              ? 'text-green-700 bg-green-100 hover:bg-green-200'
              : 'text-gray-700 bg-gray-100 hover:bg-gray-200'
          }`}
          aria-label={browser.i18n.getMessage('wordCard_markLearned')}
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
          <span>{browser.i18n.getMessage('wordCard_markLearned')}</span>
        </button>
      </div>
    </div>
  );
}
