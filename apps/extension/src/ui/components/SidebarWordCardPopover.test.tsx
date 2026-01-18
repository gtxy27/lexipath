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

vi.mock('../../shared/chat-anchor', () => ({
  makeWebAnchorKey: vi.fn(async () => 'ak_web'),
}));

vi.mock('@lexipath/dictionary', () => ({
  speak: speakMock,
  stop: stopMock,
  getVoices: vi.fn(() => []),
}));

import { WordCardPopover } from './SidebarWordCardPopover';

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

    sendMessageMock.mockImplementation(async (type: string, payload: any) => {
      if (type === 'GET_SETTINGS') {
        return { ok: true, value: { targetLanguage: 'en', nativeLanguage: 'en' } };
      }
      if (type === 'WORDBOOK_GET') {
        return { ok: true, value: null };
      }
      if (type === 'WORDBOOK_UPSERT') {
        return { ok: true, value: payload?.entry ?? null };
      }
      if (type === 'WORDBOOK_DELETE') {
        return { ok: true, value: { ok: true } };
      }
      if (type === 'EXPLAIN_WORD') {
        return { ok: true, value: mockWordData };
      }
      return { ok: true, value: null };
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
      sendMessageMock.mockImplementation(async (type: string, payload: any) => {
        if (type === 'GET_SETTINGS') {
          return { ok: true, value: { targetLanguage: 'en', nativeLanguage: 'en' } };
        }
        if (type === 'WORDBOOK_GET') {
          return { ok: true, value: null };
        }
        if (type === 'EXPLAIN_WORD') {
          return {
            ok: true,
            value: {
              word: 'test',
              definition: 'A test',
            },
          };
        }
        return { ok: true, value: null };
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
      sendMessageMock.mockImplementation(async (type: string, payload: any) => {
        if (type === 'GET_SETTINGS') {
          return { ok: true, value: { targetLanguage: 'en', nativeLanguage: 'en' } };
        }
        if (type === 'WORDBOOK_GET') {
          return { ok: true, value: null };
        }
        if (type === 'EXPLAIN_WORD') {
          return { ok: false, error: { code: 'NETWORK_ERROR', message: 'Network error' } };
        }
        return { ok: true, value: null };
      });

      render(<WordCardPopover word="test" anchorRect={mockAnchorRect} onClose={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByText('wordCard_definitionFailed')).toBeInTheDocument();
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[LexiPath:ui:WordCardPopover]',
        'Failed to fetch word data',
        { code: 'NETWORK_ERROR', message: 'Network error' }
      );
      consoleErrorSpy.mockRestore();
    });

    it('shows fallback when definition is missing', async () => {
      sendMessageMock.mockImplementation(async (type: string, payload: any) => {
        if (type === 'GET_SETTINGS') {
          return { ok: true, value: { targetLanguage: 'en', nativeLanguage: 'en' } };
        }
        if (type === 'WORDBOOK_GET') {
          return { ok: true, value: null };
        }
        if (type === 'EXPLAIN_WORD') {
          return { ok: true, value: { word: 'test' } };
        }
        return { ok: true, value: null };
      });

      render(<WordCardPopover word="test" anchorRect={mockAnchorRect} onClose={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByText('wordCard_definitionUnavailable')).toBeInTheDocument();
      });
    });

    it('handles exception during fetch', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      sendMessageMock.mockImplementation(async (type: string) => {
        if (type === 'GET_SETTINGS') {
          return { ok: true, value: { targetLanguage: 'en', nativeLanguage: 'en' } };
        }
        if (type === 'WORDBOOK_GET') {
          return { ok: true, value: null };
        }
        if (type === 'EXPLAIN_WORD') {
          throw new Error('Network failure');
        }
        return { ok: true, value: null };
      });

      render(<WordCardPopover word="test" anchorRect={mockAnchorRect} onClose={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByText('wordCard_definitionError')).toBeInTheDocument();
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[LexiPath:ui:WordCardPopover]',
        'Error fetching word data',
        expect.objectContaining({ message: 'Network failure' })
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
      const saveButton = screen.getByLabelText('wordCard_save');
      await user.click(saveButton);

      const learnedButton = screen.getByLabelText('wordCard_markLearned');
      await user.click(learnedButton);

      // No assertion needed - just checking it doesn't throw
    });

    it('shows wordbook state indicator when saved', async () => {
      sendMessageMock.mockImplementation(async (type: string, payload: any) => {
        if (type === 'GET_SETTINGS') {
          return { ok: true, value: { targetLanguage: 'en', nativeLanguage: 'en' } };
        }
        if (type === 'WORDBOOK_GET') {
          return {
            ok: true,
            value: {
              id: 'en:test',
              language: 'en',
              term: 'test',
              normalizedTerm: 'test',
              state: 'archived',
              tags: [],
              note: '',
              sources: [],
              createdAt: 1,
              updatedAt: 1,
            },
          };
        }
        if (type === 'EXPLAIN_WORD') {
          return { ok: true, value: mockWordData };
        }
        return { ok: true, value: null };
      });

      render(<WordCardPopover word="test" anchorRect={mockAnchorRect} onClose={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByText('test')).toBeInTheDocument();
      });

      expect(screen.getByText('wordCard_stateArchived')).toBeInTheDocument();
      expect(screen.getByLabelText('wordCard_unsave')).toBeInTheDocument();
    });

    it('toggles wordbook save/unsave without touching familiarity paths', async () => {
      const user = userEvent.setup();

      render(<WordCardPopover word="test" anchorRect={mockAnchorRect} onClose={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByText('test')).toBeInTheDocument();
      });

      await user.click(screen.getByLabelText('wordCard_save'));

      const typesAfterSave = sendMessageMock.mock.calls.map((call) => call[0]);
      expect(typesAfterSave).toContain('WORDBOOK_UPSERT');
      expect(typesAfterSave).not.toContain('BATCH_GET_WORD_FAMILIARITY');

      await waitFor(() => {
        expect(screen.getByLabelText('wordCard_unsave')).toBeInTheDocument();
      });

      await user.click(screen.getByLabelText('wordCard_unsave'));

      const typesAfterUnsave = sendMessageMock.mock.calls.map((call) => call[0]);
      expect(typesAfterUnsave).toContain('WORDBOOK_DELETE');
      expect(typesAfterUnsave).not.toContain('BATCH_GET_WORD_FAMILIARITY');
    });
  });

  describe('Animation', () => {
    it('renders a fixed overlay container', () => {
      const { container } = render(
        <WordCardPopover word="test" anchorRect={mockAnchorRect} onClose={vi.fn()} />
      );

      const popover = container.firstChild as HTMLElement;
      expect(popover).toHaveClass('fixed', 'z-[10000]');
    });
  });
});
