/**
 * @vitest-environment happy-dom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { browserMock, sendMessageMock, speakMock, stopMock } = vi.hoisted(() => ({
  browserMock: {
    i18n: {
      getMessage: vi.fn((key: string) => key),
    },
  },
  sendMessageMock: vi.fn(),
  speakMock: vi.fn(() => Promise.resolve()),
  stopMock: vi.fn(),
}));

vi.mock('webextension-polyfill', () => ({
  default: browserMock,
}));

vi.mock('../../shared/messages', () => ({
  sendMessage: sendMessageMock,
}));

vi.mock('@lexipath/dictionary', () => ({
  speak: speakMock,
  stop: stopMock,
  getVoices: vi.fn(() => []),
}));

import { WordCardPopover } from './WordCardPopover';

describe('WordCardPopover', () => {
  const mockAnchorRect: DOMRect = {
    top: 100,
    left: 200,
    bottom: 120,
    right: 300,
    width: 100,
    height: 20,
    x: 200,
    y: 100,
    toJSON: () => ({}),
  };

  const mockWordData = {
    word: 'test',
    phonetic: '/test/',
    definition: 'A procedure for critical evaluation',
    difficulty: 'A2',
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default: successful response
    sendMessageMock.mockResolvedValue({
      ok: true,
      value: mockWordData,
    });

    // Mock getBoundingClientRect for popover positioning
    HTMLElement.prototype.getBoundingClientRect = vi.fn(() => ({
      top: 0,
      left: 0,
      bottom: 100,
      right: 300,
      width: 300,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Loading and Data Display', () => {
    it('shows loading spinner initially', () => {
      render(<WordCardPopover word="test" anchorRect={mockAnchorRect} onClose={vi.fn()} />);

      const spinner = document.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });

    it('fetches word data on mount using sendMessage', async () => {
      render(<WordCardPopover word="test" anchorRect={mockAnchorRect} onClose={vi.fn()} />);

      await waitFor(() => {
        expect(sendMessageMock).toHaveBeenCalledWith('EXPLAIN_WORD', { word: 'test' });
      });
    });

    it('displays word card after data loads', async () => {
      render(<WordCardPopover word="test" anchorRect={mockAnchorRect} onClose={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByText('test')).toBeInTheDocument();
      });

      expect(screen.getByText('/test/')).toBeInTheDocument();
      expect(screen.getByText('A procedure for critical evaluation')).toBeInTheDocument();
      expect(screen.getByText('A2')).toBeInTheDocument();
    });

    it('handles missing optional fields', async () => {
      sendMessageMock.mockResolvedValue({
        ok: true,
        value: {
          word: 'test',
          definition: 'A test',
        },
      });

      render(<WordCardPopover word="test" anchorRect={mockAnchorRect} onClose={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByText('test')).toBeInTheDocument();
      });

      expect(screen.getByText('A test')).toBeInTheDocument();
      expect(screen.queryByText('/test/')).not.toBeInTheDocument();
      expect(screen.queryByText('A2')).not.toBeInTheDocument();
    });

    it('shows error message when fetch fails', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      sendMessageMock.mockResolvedValue({
        ok: false,
        error: { code: 'NETWORK_ERROR', message: 'Network error' },
      });

      render(<WordCardPopover word="test" anchorRect={mockAnchorRect} onClose={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByText('wordCard_definitionFailed')).toBeInTheDocument();
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[WordCardPopover] Failed to fetch word data:',
        { code: 'NETWORK_ERROR', message: 'Network error' }
      );
      consoleErrorSpy.mockRestore();
    });

    it('shows fallback when definition is missing', async () => {
      sendMessageMock.mockResolvedValue({
        ok: true,
        value: {
          word: 'test',
        },
      });

      render(<WordCardPopover word="test" anchorRect={mockAnchorRect} onClose={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByText('wordCard_definitionUnavailable')).toBeInTheDocument();
      });
    });

    it('handles exception during fetch', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      sendMessageMock.mockRejectedValue(new Error('Network failure'));

      render(<WordCardPopover word="test" anchorRect={mockAnchorRect} onClose={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByText('wordCard_definitionError')).toBeInTheDocument();
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[WordCardPopover] Error fetching word data:',
        expect.any(Error)
      );
      consoleErrorSpy.mockRestore();
    });
  });

  describe('Positioning', () => {
    it('renders popover with fixed positioning', async () => {
      const { container } = render(
        <WordCardPopover word="test" anchorRect={mockAnchorRect} onClose={vi.fn()} />
      );

      await waitFor(() => {
        expect(screen.getByText('test')).toBeInTheDocument();
      });

      const popover = container.firstChild as HTMLElement;
      // Check that popover has fixed positioning class
      expect(popover.className).toContain('fixed');
      // Check that it has inline styles for top and left positioning
      expect(popover).toHaveAttribute('style');
    });
  });

  describe('Mode Behavior', () => {
    it('shows close button in click mode', async () => {
      render(
        <WordCardPopover word="test" anchorRect={mockAnchorRect} mode="click" onClose={vi.fn()} />
      );

      await waitFor(() => {
        expect(screen.getByText('test')).toBeInTheDocument();
      });

      expect(screen.getByLabelText('wordCard_close')).toBeInTheDocument();
    });

    it('does not show close button in hover mode', async () => {
      render(
        <WordCardPopover word="test" anchorRect={mockAnchorRect} mode="hover" onClose={vi.fn()} />
      );

      await waitFor(() => {
        expect(screen.getByText('test')).toBeInTheDocument();
      });

      expect(screen.queryByLabelText('wordCard_close')).not.toBeInTheDocument();
    });
  });

  describe('User Interactions', () => {
    it('calls onClose when close button is clicked', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();

      render(
        <WordCardPopover word="test" anchorRect={mockAnchorRect} mode="click" onClose={onClose} />
      );

      await waitFor(() => {
        expect(screen.getByText('test')).toBeInTheDocument();
      });

      const closeButton = screen.getByLabelText('wordCard_close');
      await user.click(closeButton);

      expect(onClose).toHaveBeenCalled();
    });

    it('forwards onFavoriteToggle callback', async () => {
      const user = userEvent.setup();
      const onFavoriteToggle = vi.fn();

      render(
        <WordCardPopover
          word="test"
          anchorRect={mockAnchorRect}
          onClose={vi.fn()}
          onFavoriteToggle={onFavoriteToggle}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('test')).toBeInTheDocument();
      });

      const favoriteButton = screen.getByLabelText('wordCard_favorite');
      await user.click(favoriteButton);

      expect(onFavoriteToggle).toHaveBeenCalledWith('test', true);
    });

    it('forwards onLearnedToggle callback', async () => {
      const user = userEvent.setup();
      const onLearnedToggle = vi.fn();

      render(
        <WordCardPopover
          word="test"
          anchorRect={mockAnchorRect}
          onClose={vi.fn()}
          onLearnedToggle={onLearnedToggle}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('test')).toBeInTheDocument();
      });

      const learnedButton = screen.getByLabelText('wordCard_markLearned');
      await user.click(learnedButton);

      expect(onLearnedToggle).toHaveBeenCalledWith('test', true);
    });

    it('works without optional callbacks', async () => {
      const user = userEvent.setup();

      render(<WordCardPopover word="test" anchorRect={mockAnchorRect} onClose={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByText('test')).toBeInTheDocument();
      });

      // Should not throw when clicking without callbacks
      const favoriteButton = screen.getByLabelText('wordCard_favorite');
      await user.click(favoriteButton);

      const learnedButton = screen.getByLabelText('wordCard_markLearned');
      await user.click(learnedButton);

      // No assertion needed - just checking it doesn't throw
    });
  });

  describe('Animation', () => {
    it('starts with opacity-0 class', () => {
      const { container } = render(
        <WordCardPopover word="test" anchorRect={mockAnchorRect} onClose={vi.fn()} />
      );

      const popover = container.firstChild as HTMLElement;
      expect(popover).toHaveClass('opacity-0');
    });

    it('transitions to opacity-100 after data loads', async () => {
      const { container } = render(
        <WordCardPopover word="test" anchorRect={mockAnchorRect} onClose={vi.fn()} />
      );

      await waitFor(() => {
        expect(screen.getByText('test')).toBeInTheDocument();
      });

      const popover = container.firstChild as HTMLElement;

      // Wait for animation to complete
      await waitFor(
        () => {
          expect(popover).toHaveClass('opacity-100');
        },
        { timeout: 500 }
      );
    });

    it('applies transition duration class', () => {
      const { container } = render(
        <WordCardPopover word="test" anchorRect={mockAnchorRect} onClose={vi.fn()} />
      );

      const popover = container.firstChild as HTMLElement;
      expect(popover).toHaveClass('transition-opacity', 'duration-200');
    });
  });
});
