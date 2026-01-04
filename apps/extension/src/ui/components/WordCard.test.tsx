/**
 * @vitest-environment happy-dom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { browserMock, speakMock, stopMock } = vi.hoisted(() => ({
  browserMock: {
    i18n: {
      getMessage: vi.fn((key: string) => key),
    },
  },
  speakMock: vi.fn(() => Promise.resolve()),
  stopMock: vi.fn(),
}));

vi.mock('webextension-polyfill', () => ({
  default: browserMock,
}));

vi.mock('@lexipath/dictionary', () => ({
  speak: speakMock,
  stop: stopMock,
  getVoices: vi.fn(() => []),
}));

import { WordCard, type WordCardData } from './WordCard';

describe('WordCard', () => {
  const mockData: WordCardData = {
    word: 'example',
    phonetic: '/ɪɡˈzɑːm.pəl/',
    definition: 'A thing characteristic of its kind or illustrating a general rule.',
    difficulty: 'B1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('renders word and definition', () => {
      render(<WordCard data={mockData} />);

      expect(screen.getByText('example')).toBeInTheDocument();
      expect(screen.getByText('/ɪɡˈzɑːm.pəl/')).toBeInTheDocument();
      expect(
        screen.getByText('A thing characteristic of its kind or illustrating a general rule.')
      ).toBeInTheDocument();
    });

    it('renders difficulty badge', () => {
      render(<WordCard data={mockData} />);

      const badge = screen.getByText('B1');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveClass('bg-amber-500', 'text-white');
    });

    it('renders without phonetic when not provided', () => {
      const { phonetic: _phonetic, ...dataWithoutPhonetic } = mockData;
      render(<WordCard data={dataWithoutPhonetic} />);

      expect(screen.getByText('example')).toBeInTheDocument();
      expect(screen.queryByText('/ɪɡˈzɑːm.pəl/')).not.toBeInTheDocument();
    });

    it('renders without difficulty when not provided', () => {
      const { difficulty: _difficulty, ...dataWithoutDifficulty } = mockData;
      render(<WordCard data={dataWithoutDifficulty} />);

      expect(screen.queryByText('B1')).not.toBeInTheDocument();
    });

    it('shows close button only in click mode', () => {
      const { rerender } = render(<WordCard data={mockData} mode="click" onClose={vi.fn()} />);
      expect(screen.getByLabelText('wordCard_close')).toBeInTheDocument();

      rerender(<WordCard data={mockData} mode="hover" />);
      expect(screen.queryByLabelText('wordCard_close')).not.toBeInTheDocument();
    });

    it('hides close button when onClose is not provided', () => {
      render(<WordCard data={mockData} mode="click" />);
      expect(screen.queryByLabelText('wordCard_close')).not.toBeInTheDocument();
    });
  });

  describe('Difficulty Colors', () => {
    it('applies green color for A1 level', () => {
      render(<WordCard data={{ ...mockData, difficulty: 'A1' }} />);
      const badge = screen.getByText('A1');
      expect(badge).toHaveClass('bg-emerald-500', 'text-white');
    });

    it('applies green color for A2 level', () => {
      render(<WordCard data={{ ...mockData, difficulty: 'A2' }} />);
      const badge = screen.getByText('A2');
      expect(badge).toHaveClass('bg-emerald-500', 'text-white');
    });

    it('applies yellow color for B1 level', () => {
      render(<WordCard data={{ ...mockData, difficulty: 'B1' }} />);
      const badge = screen.getByText('B1');
      expect(badge).toHaveClass('bg-amber-500', 'text-white');
    });

    it('applies yellow color for B2 level', () => {
      render(<WordCard data={{ ...mockData, difficulty: 'B2' }} />);
      const badge = screen.getByText('B2');
      expect(badge).toHaveClass('bg-amber-500', 'text-white');
    });

    it('applies red color for C1 level', () => {
      render(<WordCard data={{ ...mockData, difficulty: 'C1' }} />);
      const badge = screen.getByText('C1');
      expect(badge).toHaveClass('bg-rose-500', 'text-white');
    });

    it('applies red color for C2 level', () => {
      render(<WordCard data={{ ...mockData, difficulty: 'C2' }} />);
      const badge = screen.getByText('C2');
      expect(badge).toHaveClass('bg-rose-500', 'text-white');
    });

    it('applies gray color for unknown difficulty', () => {
      render(<WordCard data={{ ...mockData, difficulty: 'Unknown' }} />);
      const badge = screen.getByText('Unknown');
      expect(badge).toHaveClass('bg-gray-200', 'text-gray-600');
    });
  });

  describe('Pronunciation', () => {
    it('calls speak function when pronounce button is clicked', async () => {
      const user = userEvent.setup();
      render(<WordCard data={mockData} ttsLang="ja-JP" />);

      const pronounceButton = screen.getByLabelText('wordCard_pronounce');
      await user.click(pronounceButton);

      expect(speakMock).toHaveBeenCalledWith('example', 'ja-JP');
    });

    it('disables button while audio is playing', async () => {
      const user = userEvent.setup();
      let resolveSpeakPromise: (() => void) | undefined;
      speakMock.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveSpeakPromise = resolve;
          })
      );

      render(<WordCard data={mockData} />);

      const pronounceButton = screen.getByLabelText('wordCard_pronounce');
      await user.click(pronounceButton);

      expect(pronounceButton).toBeDisabled();

      // Resolve the promise to re-enable the button
      resolveSpeakPromise?.();
      await waitFor(() => {
        expect(pronounceButton).not.toBeDisabled();
      });
    });

    it('button remains disabled while audio is playing and never resolves', async () => {
      const user = userEvent.setup();
      speakMock.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(<WordCard data={mockData} />);

      const pronounceButton = screen.getByLabelText('wordCard_pronounce');

      // Start playing
      await user.click(pronounceButton);
      expect(speakMock).toHaveBeenCalledTimes(1);

      // Button should remain disabled while playing
      expect(pronounceButton).toBeDisabled();
    });

    it('handles TTS errors gracefully', async () => {
      const user = userEvent.setup();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      speakMock.mockRejectedValue(new Error('TTS error'));

      render(<WordCard data={mockData} />);

      const pronounceButton = screen.getByLabelText('wordCard_pronounce');
      await user.click(pronounceButton);

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith('[WordCard] TTS error:', expect.any(Error));
      });

      expect(pronounceButton).not.toBeDisabled();
      consoleErrorSpy.mockRestore();
    });
  });

  describe('Favorite Toggle', () => {
    it('toggles favorite state when clicked', async () => {
      const user = userEvent.setup();
      const onFavoriteToggle = vi.fn();
      render(<WordCard data={mockData} onFavoriteToggle={onFavoriteToggle} />);

      const favoriteButton = screen.getByLabelText('wordCard_favorite');

      // First click - toggle to favorited
      await user.click(favoriteButton);
      expect(onFavoriteToggle).toHaveBeenCalledWith('example', true);
      expect(favoriteButton).toHaveClass('text-yellow-600', 'bg-yellow-50');

      // Second click - toggle back to not favorited
      await user.click(favoriteButton);
      expect(onFavoriteToggle).toHaveBeenCalledWith('example', false);
      expect(favoriteButton).toHaveClass('text-gray-400');
    });

    it('renders with initial favorited state', () => {
      const dataFavorited = { ...mockData, isFavorited: true };
      render(<WordCard data={dataFavorited} />);

      const favoriteButton = screen.getByLabelText('wordCard_favorite');
      expect(favoriteButton).toHaveClass('text-yellow-600', 'bg-yellow-50');

      const starIcon = favoriteButton.querySelector('svg');
      expect(starIcon).toHaveClass('fill-current');
    });

    it('renders with initial unfavorited state', () => {
      const dataUnfavorited = { ...mockData, isFavorited: false };
      render(<WordCard data={dataUnfavorited} />);

      const favoriteButton = screen.getByLabelText('wordCard_favorite');
      expect(favoriteButton).toHaveClass('text-gray-400');

      const starIcon = favoriteButton.querySelector('svg');
      expect(starIcon).not.toHaveClass('fill-current');
    });

    it('works without onFavoriteToggle callback', async () => {
      const user = userEvent.setup();
      render(<WordCard data={mockData} />);

      const favoriteButton = screen.getByLabelText('wordCard_favorite');

      // Should not throw error when clicking
      await user.click(favoriteButton);
      expect(favoriteButton).toHaveClass('text-yellow-600', 'bg-yellow-50');
    });
  });

  describe('Learned Toggle', () => {
    it('toggles learned state when clicked', async () => {
      const user = userEvent.setup();
      const onLearnedToggle = vi.fn();
      render(<WordCard data={mockData} onLearnedToggle={onLearnedToggle} />);

      const learnedButton = screen.getByLabelText('wordCard_markLearned');

      // First click - toggle to learned
      await user.click(learnedButton);
      expect(onLearnedToggle).toHaveBeenCalledWith('example', true);
      expect(learnedButton).toHaveClass('text-emerald-600', 'bg-emerald-50');

      // Second click - toggle back to not learned
      await user.click(learnedButton);
      expect(onLearnedToggle).toHaveBeenCalledWith('example', false);
      expect(learnedButton).toHaveClass('text-gray-400');
    });

    it('renders with initial learned state', () => {
      const dataLearned = { ...mockData, isLearned: true };
      render(<WordCard data={dataLearned} />);

      const learnedButton = screen.getByLabelText('wordCard_markLearned');
      expect(learnedButton).toHaveClass('text-emerald-600', 'bg-emerald-50');
    });

    it('renders with initial unlearned state', () => {
      const dataUnlearned = { ...mockData, isLearned: false };
      render(<WordCard data={dataUnlearned} />);

      const learnedButton = screen.getByLabelText('wordCard_markLearned');
      expect(learnedButton).toHaveClass('text-gray-400');
    });

    it('works without onLearnedToggle callback', async () => {
      const user = userEvent.setup();
      render(<WordCard data={mockData} />);

      const learnedButton = screen.getByLabelText('wordCard_markLearned');

      // Should not throw error when clicking
      await user.click(learnedButton);
      expect(learnedButton).toHaveClass('text-emerald-600', 'bg-emerald-50');
    });
  });

  describe('Close Button', () => {
    it('calls onClose when close button is clicked', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<WordCard data={mockData} mode="click" onClose={onClose} />);

      const closeButton = screen.getByLabelText('wordCard_close');
      await user.click(closeButton);

      expect(stopMock).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });

    it('stops audio when closing', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<WordCard data={mockData} mode="click" onClose={onClose} />);

      const closeButton = screen.getByLabelText('wordCard_close');
      await user.click(closeButton);

      expect(stopMock).toHaveBeenCalled();
    });
  });

  describe('Mode Behavior', () => {
    it('defaults to click mode', () => {
      render(<WordCard data={mockData} />);
      expect(screen.queryByLabelText('wordCard_close')).not.toBeInTheDocument();
    });

    it('respects mode prop', () => {
      const { rerender } = render(<WordCard data={mockData} mode="hover" />);
      expect(screen.queryByLabelText('wordCard_close')).not.toBeInTheDocument();

      rerender(<WordCard data={mockData} mode="click" onClose={vi.fn()} />);
      expect(screen.getByLabelText('wordCard_close')).toBeInTheDocument();
    });
  });

  describe('i18n Integration', () => {
    it('uses i18n for all button labels', () => {
      const onClose = vi.fn();
      render(<WordCard data={mockData} mode="click" onClose={onClose} />);

      expect(browserMock.i18n.getMessage).toHaveBeenCalledWith('wordCard_close');
      expect(browserMock.i18n.getMessage).toHaveBeenCalledWith('wordCard_pronounce');
      expect(browserMock.i18n.getMessage).toHaveBeenCalledWith('wordCard_favorite');
      expect(browserMock.i18n.getMessage).toHaveBeenCalledWith('wordCard_markLearned');
    });
  });
});
