/**
 * @vitest-environment happy-dom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

const elementProto = (globalThis.HTMLElement?.prototype ?? globalThis.Element?.prototype) as any;
if (elementProto && typeof elementProto.hasPointerCapture !== 'function') {
  elementProto.hasPointerCapture = () => false;
}
if (elementProto && typeof elementProto.setPointerCapture !== 'function') {
  elementProto.setPointerCapture = () => {};
}
if (elementProto && typeof elementProto.releasePointerCapture !== 'function') {
  elementProto.releasePointerCapture = () => {};
}

// Mock dependencies using vi.hoisted
const { browserMock, sendMessageMock } = vi.hoisted(() => ({
  browserMock: {
    i18n: {
      getMessage: vi.fn((key: string, substitutions?: string | string[]) => {
        if (key === 'onboardingStepProgress') {
          return `Step ${substitutions} of 3`;
        }
        return key;
      }),
    },
  },
  sendMessageMock: vi.fn((_type: string, _payload: unknown) =>
    Promise.resolve({ ok: true, value: {} }),
  ),
}));

vi.mock('webextension-polyfill', () => ({
  default: browserMock,
}));

vi.mock('../../shared/messages', () => ({
  sendMessage: sendMessageMock,
}));

import { Onboarding } from './Onboarding';

const DEFAULT_SETTINGS = {
  theme: 'system',
  nativeLanguage: 'zh-CN',
  targetLanguage: 'en',
  proficiencyLevel: 'B1',
  targetProficiencyLevel: 'B2',
  webEnhanceMode: 'i_plus_1',
  hasCompletedOnboarding: false,
};

function getSelectOption(name: string): HTMLElement {
  return (
    screen.queryByRole('option', { name }) ??
    screen.queryByText(name) ??
    (() => {
      throw new Error(`Select option not found: ${name}`);
    })()
  );
}

async function selectFromSelect(
  user: ReturnType<typeof userEvent.setup>,
  triggerTestId: string,
  optionName: string,
) {
  await user.click(screen.getByTestId(triggerTestId));
  await user.click(getSelectOption(optionName));
}

describe('Onboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMessageMock.mockImplementation((kind: string) => {
      if (kind === 'GET_SETTINGS') {
        return Promise.resolve({ ok: true, value: { ...DEFAULT_SETTINGS } });
      }
      return Promise.resolve({ ok: true, value: {} });
    });
    // Mock window.close
    vi.stubGlobal('close', vi.fn());
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  describe('Step 1: Learning Level Selection', () => {
    it('renders step 1 by default', () => {
      render(<Onboarding />);

      expect(screen.getByText('onboardingStep1Title')).toBeInTheDocument();
      expect(screen.getByText('onboardingStep1Desc')).toBeInTheDocument();
    });

    it('shows progress indicator at step 1', () => {
      render(<Onboarding />);

      expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
    });

    it('renders all target language options', () => {
      render(<Onboarding />);

      expect(screen.getByText('languageTarget_en')).toBeInTheDocument();
      expect(screen.getByText('languageTarget_ja')).toBeInTheDocument();
      expect(screen.getByText('languageTarget_ko')).toBeInTheDocument();
      expect(screen.getByText('languageTarget_fr')).toBeInTheDocument();
      expect(screen.getByText('languageTarget_de')).toBeInTheDocument();
      expect(screen.getByText('languageTarget_zh')).toBeInTheDocument();
    });

    it('selects English by default', () => {
      render(<Onboarding />);

      const elements = screen.getAllByText('languageTarget_en');
      const enButton = elements[0]!.closest('button');
      expect(enButton).not.toBeNull();
      expect(enButton).toHaveClass('bg-primary');
    });

    it('defaults to CEFR user+target levels', () => {
      render(<Onboarding />);

      expect(screen.getByTestId('onboarding-user-level-scale')).toHaveTextContent('CEFR');
      expect(screen.getByTestId('onboarding-user-level-value')).toHaveTextContent('proficiency_B1');
      expect(screen.getByTestId('onboarding-target-level-scale')).toHaveTextContent('CEFR');
      expect(screen.getByTestId('onboarding-target-level-value')).toHaveTextContent('proficiency_B2');
    });

    it('exposes IELTS + CET scales for English (zh native)', async () => {
      const user = userEvent.setup();
      render(<Onboarding />);

      await user.click(screen.getByTestId('onboarding-user-level-scale'));
      expect(getSelectOption('IELTS')).toBeInTheDocument();
      expect(getSelectOption('CET-4')).toBeInTheDocument();
      expect(getSelectOption('CET-6')).toBeInTheDocument();

      await user.keyboard('{Escape}');
    });

    it('shows JLPT scale when Japanese is selected', async () => {
      const user = userEvent.setup();
      render(<Onboarding />);

      await user.click(screen.getByText('languageTarget_ja'));
      await user.click(screen.getByTestId('onboarding-user-level-scale'));
      expect(getSelectOption('JLPT')).toBeInTheDocument();
      await user.keyboard('{Escape}');
    });

    it('defaults to JLPT N3 after selecting JLPT scale', async () => {
      const user = userEvent.setup();
      render(<Onboarding />);

      await user.click(screen.getByText('languageTarget_ja'));
      await selectFromSelect(user, 'onboarding-user-level-scale', 'JLPT');
      expect(screen.getByTestId('onboarding-user-level-value')).toHaveTextContent('proficiency_N3');
    });

    it('shows TOPIK scale when Korean is selected', async () => {
      const user = userEvent.setup();
      render(<Onboarding />);

      await user.click(screen.getByText('languageTarget_ko'));
      await user.click(screen.getByTestId('onboarding-user-level-scale'));
      expect(getSelectOption('TOPIK')).toBeInTheDocument();
      await user.keyboard('{Escape}');
    });

    it('allows selecting different CEFR levels', async () => {
      const user = userEvent.setup();
      render(<Onboarding />);

      await selectFromSelect(user, 'onboarding-user-level-value', 'proficiency_C1');
      expect(screen.getByTestId('onboarding-user-level-value')).toHaveTextContent('proficiency_C1');
    });

    it('preserves proficiency selection when switching between CEFR languages', async () => {
      const user = userEvent.setup();
      render(<Onboarding />);

      await selectFromSelect(user, 'onboarding-user-level-value', 'proficiency_C1');
      await user.click(screen.getByText('languageTarget_fr').closest('button')!);
      expect(screen.getByTestId('onboarding-user-level-value')).toHaveTextContent('proficiency_C1');
    });

    it('supports selecting JLPT and TOPIK levels', async () => {
      const user = userEvent.setup();
      render(<Onboarding />);

      await user.click(screen.getByText('languageTarget_ja'));
      await selectFromSelect(user, 'onboarding-user-level-scale', 'JLPT');
      await selectFromSelect(user, 'onboarding-user-level-value', 'proficiency_N2');
      expect(screen.getByTestId('onboarding-user-level-value')).toHaveTextContent('proficiency_N2');

      await user.click(screen.getByText('languageTarget_ko'));
      await selectFromSelect(user, 'onboarding-user-level-scale', 'TOPIK');
      await selectFromSelect(user, 'onboarding-user-level-value', 'proficiency_TOPIK5');
      expect(screen.getByTestId('onboarding-user-level-value')).toHaveTextContent('proficiency_TOPIK5');
    });
  });

  describe('Step 2: Reading Style', () => {
    it('navigates to step 2 when next is clicked', async () => {
      const user = userEvent.setup();
      render(<Onboarding />);

      const nextButton = screen.getByText('onboardingNext');
      await user.click(nextButton);

      expect(screen.getByText('onboardingStep2Title')).toBeInTheDocument();
      expect(screen.getByText('onboardingStep2Desc')).toBeInTheDocument();
      expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();
    });

    it('renders all reading style options', async () => {
      const user = userEvent.setup();
      render(<Onboarding />);

      await user.click(screen.getByText('onboardingNext'));

      expect(screen.getByText('onboardingEnhanceModeBreezeTitle')).toBeInTheDocument();
      expect(screen.getByText('onboardingEnhanceModeGuidedTitle')).toBeInTheDocument();
      expect(screen.getByText('onboardingEnhanceModeImmersionTitle')).toBeInTheDocument();
    });

    it('shows style descriptions', async () => {
      const user = userEvent.setup();
      render(<Onboarding />);

      await user.click(screen.getByText('onboardingNext'));

      expect(screen.getByText('onboardingEnhanceModeBreezeDesc')).toBeInTheDocument();
      expect(screen.getByText('onboardingEnhanceModeGuidedDesc')).toBeInTheDocument();
      expect(screen.getByText('onboardingEnhanceModeImmersionDesc')).toBeInTheDocument();
    });

    it('defaults to Guided style', async () => {
      const user = userEvent.setup();
      render(<Onboarding />);

      await user.click(screen.getByText('onboardingNext'));
      await user.click(screen.getByText('onboardingNext'));

      expect(screen.getByTestId('summary-enhance-mode')).toHaveTextContent('onboardingEnhanceModeSummary_i_plus_1');
    });

    it('allows selecting a different style', async () => {
      const user = userEvent.setup();
      render(<Onboarding />);

      await user.click(screen.getByText('onboardingNext'));

      await user.click(screen.getByText('onboardingEnhanceModeImmersionTitle'));
      await user.click(screen.getByText('onboardingNext'));

      expect(screen.getByTestId('summary-enhance-mode')).toHaveTextContent('onboardingEnhanceModeSummary_full');
    });

    it('shows previous button on step 2', async () => {
      const user = userEvent.setup();
      render(<Onboarding />);

      await user.click(screen.getByText('onboardingNext'));

      const prevButton = screen.getByText('onboardingPrevious');
      expect(prevButton).toBeInTheDocument();
      expect(prevButton).not.toBeDisabled();
    });
  });

  describe('Step 3: Confirmation', () => {
    it('navigates to step 3 when next is clicked from step 2', async () => {
      const user = userEvent.setup();
      render(<Onboarding />);

      await user.click(screen.getByText('onboardingNext'));
      await user.click(screen.getByText('onboardingNext'));

      expect(screen.getByText('onboardingStep3Title')).toBeInTheDocument();
      expect(screen.getByText('onboardingStep3Desc')).toBeInTheDocument();
      expect(screen.getByText('Step 3 of 3')).toBeInTheDocument();
    });

    it('shows summary of selected options', async () => {
      render(<Onboarding />);
      const user = userEvent.setup();

      // Go to step 3
      await user.click(screen.getByText('onboardingNext'));
      await user.click(screen.getByText('onboardingNext'));

      expect(screen.getByText('onboardingSummaryTargetLanguage')).toBeInTheDocument();
      expect(screen.getByText('onboardingSummaryEnhanceMode')).toBeInTheDocument();
      expect(screen.getByTestId('summary-target-lang')).toHaveTextContent('languageTarget_en');
      expect(screen.getByTestId('summary-proficiency')).toHaveTextContent('proficiency_B1');
      expect(screen.getByTestId('summary-target-level')).toHaveTextContent('proficiency_B2');
      expect(screen.getByTestId('summary-enhance-mode')).toHaveTextContent('onboardingEnhanceModeSummary_i_plus_1');
    });

    it('shows correct summary for Japanese selection', async () => {
      render(<Onboarding />);
      const user = userEvent.setup();

      // Select Japanese
      await user.click(screen.getByText('languageTarget_ja'));
      await selectFromSelect(user, 'onboarding-user-level-scale', 'JLPT');
      await selectFromSelect(user, 'onboarding-user-level-value', 'proficiency_N3');

      // Go to step 3
      await user.click(screen.getByText('onboardingNext'));
      await user.click(screen.getByText('onboardingNext'));

      expect(screen.getByTestId('summary-target-lang')).toHaveTextContent('languageTarget_ja');
      expect(screen.getByTestId('summary-proficiency')).toHaveTextContent('proficiency_N3');
    });

    it('shows note about adjusting settings later', async () => {
      const user = userEvent.setup();
      render(<Onboarding />);

      await user.click(screen.getByText('onboardingNext'));
      await user.click(screen.getByText('onboardingNext'));

      expect(screen.getByText('onboardingSummaryNote')).toBeInTheDocument();
    });

    it('shows finish button instead of next', async () => {
      const user = userEvent.setup();
      render(<Onboarding />);

      await user.click(screen.getByText('onboardingNext'));
      await user.click(screen.getByText('onboardingNext'));

      expect(screen.queryByText('onboardingNext')).not.toBeInTheDocument();
      expect(screen.getByText('onboardingFinish')).toBeInTheDocument();
    });
  });

  describe('Navigation', () => {
    it('disables previous button on step 1', () => {
      render(<Onboarding />);

      const prevButton = screen.getByText('onboardingPrevious');
      expect(prevButton).toBeDisabled();
    });

    it('navigates back from step 2 to step 1', async () => {
      const user = userEvent.setup();
      render(<Onboarding />);

      await user.click(screen.getByText('onboardingNext'));
      expect(screen.getByText('onboardingStep2Title')).toBeInTheDocument();

      await user.click(screen.getByText('onboardingPrevious'));
      expect(screen.getByText('onboardingStep1Title')).toBeInTheDocument();
      expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
    });

    it('navigates back from step 3 to step 2', async () => {
      const user = userEvent.setup();
      render(<Onboarding />);

      await user.click(screen.getByText('onboardingNext'));
      await user.click(screen.getByText('onboardingNext'));
      expect(screen.getByText('onboardingStep3Title')).toBeInTheDocument();

      await user.click(screen.getByText('onboardingPrevious'));
      expect(screen.getByText('onboardingStep2Title')).toBeInTheDocument();
    });

    it('preserves selections when navigating back and forth', async () => {
      const user = userEvent.setup();
      render(<Onboarding />);

      // Select French and C2
      await user.click(screen.getByText('languageTarget_fr').closest('button')!);
      await selectFromSelect(user, 'onboarding-user-level-value', 'proficiency_C2');

      // Go to step 2
      await user.click(screen.getByText('onboardingNext'));

      // Pick a different reading style
      await user.click(screen.getByText('onboardingEnhanceModeImmersionTitle'));

      // Go back to step 1
      await user.click(screen.getByText('onboardingPrevious'));

      // Verify selections are preserved
      const frButtonAfter = screen.getByText('languageTarget_fr').closest('button');
      expect(frButtonAfter).toHaveClass('bg-primary');
      expect(screen.getByTestId('onboarding-user-level-value')).toHaveTextContent('proficiency_C2');

      // Go forward to step 2 again
      await user.click(screen.getByText('onboardingNext'));

      // Verify style selection is preserved via summary
      await user.click(screen.getByText('onboardingNext'));
      expect(screen.getByTestId('summary-enhance-mode')).toHaveTextContent('onboardingEnhanceModeSummary_full');
    });
  });

  describe('Saving Settings', () => {
    it('saves settings when finish is clicked', async () => {
      const user = userEvent.setup();
      render(<Onboarding />);

      await user.click(screen.getByText('onboardingNext'));
      await user.click(screen.getByText('onboardingNext'));
      await user.click(screen.getByText('onboardingFinish'));

      await waitFor(() => {
        expect(sendMessageMock).toHaveBeenCalledWith(
          'SET_SETTINGS',
          expect.objectContaining({
            targetLanguage: 'en',
            proficiencyLevel: 'B1',
            targetProficiencyLevel: 'B2',
            webEnhanceMode: 'i_plus_1',
            hasCompletedOnboarding: true,
          }),
        );
      });
    });

    it('converts JLPT to CEFR when saving', async () => {
      const user = userEvent.setup();
      render(<Onboarding />);

      // Select Japanese N2
      await user.click(screen.getByText('languageTarget_ja'));
      await selectFromSelect(user, 'onboarding-user-level-scale', 'JLPT');
      await selectFromSelect(user, 'onboarding-user-level-value', 'proficiency_N2');

      await user.click(screen.getByText('onboardingNext'));
      await user.click(screen.getByText('onboardingNext'));
      await user.click(screen.getByText('onboardingFinish'));

      await waitFor(() => {
        expect(sendMessageMock).toHaveBeenCalledWith(
          'SET_SETTINGS',
          expect.objectContaining({
            targetLanguage: 'ja',
            proficiencyLevel: 'B2', // N2 maps to B2
            proficiencyPreference: { standard: 'JLPT', value: 'N2' },
            targetProficiencyLevel: 'B2',
            webEnhanceMode: 'i_plus_1',
            hasCompletedOnboarding: true,
          }),
        );
      });
    });

    it('converts TOPIK to CEFR when saving', async () => {
      const user = userEvent.setup();
      render(<Onboarding />);

      // Select Korean TOPIK 5
      await user.click(screen.getByText('languageTarget_ko'));
      await selectFromSelect(user, 'onboarding-user-level-scale', 'TOPIK');
      await selectFromSelect(user, 'onboarding-user-level-value', 'proficiency_TOPIK5');

      await user.click(screen.getByText('onboardingNext'));
      await user.click(screen.getByText('onboardingNext'));
      await user.click(screen.getByText('onboardingFinish'));

      await waitFor(() => {
        expect(sendMessageMock).toHaveBeenCalledWith(
          'SET_SETTINGS',
          expect.objectContaining({
            targetLanguage: 'ko',
            proficiencyLevel: 'C1', // TOPIK 5 maps to C1
            proficiencyPreference: { standard: 'TOPIK', value: '5' },
            targetProficiencyLevel: 'B2',
            webEnhanceMode: 'i_plus_1',
            hasCompletedOnboarding: true,
          }),
        );
      });
    });

    it('disables finish button while saving', async () => {
      const user = userEvent.setup();
      let resolveSave: (() => void) | undefined;
      sendMessageMock.mockImplementation(
        (type: string) => {
          if (type === 'GET_SETTINGS') {
            return Promise.resolve({ ok: true, value: { ...DEFAULT_SETTINGS } });
          }
          return new Promise<{ ok: true; value: {} }>((resolve) => {
            resolveSave = () => resolve({ ok: true, value: {} });
          });
        },
      );

      render(<Onboarding />);

      await user.click(screen.getByText('onboardingNext'));
      await user.click(screen.getByText('onboardingNext'));

      const finishButton = screen.getByText('onboardingFinish');
      await user.click(finishButton);

      // Should show saving state
      await waitFor(() => {
        expect(screen.getByText('optionsSaving')).toBeInTheDocument();
      });
      expect(finishButton).toBeDisabled();

      // Resolve and verify button is re-enabled
      resolveSave?.();
      await waitFor(() => {
        expect(finishButton).not.toBeDisabled();
      });
    });

    it('closes window after successful save', async () => {
      const user = userEvent.setup();
      const closeMock = vi.fn();
      vi.stubGlobal('close', closeMock);

      render(<Onboarding />);

      await user.click(screen.getByText('onboardingNext'));
      await user.click(screen.getByText('onboardingNext'));
      await user.click(screen.getByText('onboardingFinish'));

      // Wait for async operation to complete
      await waitFor(
        () => {
          expect(closeMock).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );
    });

    it('handles save errors gracefully', async () => {
      const user = userEvent.setup();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      sendMessageMock.mockImplementation((type: string) => {
        if (type === 'GET_SETTINGS') {
          return Promise.resolve({ ok: true, value: { ...DEFAULT_SETTINGS } });
        }
        return Promise.reject(new Error('Save failed'));
      });

      render(<Onboarding />);

      await user.click(screen.getByText('onboardingNext'));
      await user.click(screen.getByText('onboardingNext'));
      await user.click(screen.getByText('onboardingFinish'));

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          '[LexiPath:ui:Onboarding]',
          'Failed to save onboarding settings',
          expect.objectContaining({ message: 'Save failed' })
        );
      });

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Progress Indicator', () => {
    it('shows correct progress for each step', async () => {
      const user = userEvent.setup();
      render(<Onboarding />);

      expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();

      await user.click(screen.getByText('onboardingNext'));
      expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();

      await user.click(screen.getByText('onboardingNext'));
      expect(screen.getByText('Step 3 of 3')).toBeInTheDocument();
    });

    it('renders a progress bar', () => {
      render(<Onboarding />);
      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });
  });

  describe('i18n Integration', () => {
    it('uses browser.i18n.getMessage for all text', () => {
      render(<Onboarding />);

      // Verify key i18n calls (check that they were called at some point)
      expect(browserMock.i18n.getMessage).toHaveBeenCalledWith('welcomeTitle');
      expect(browserMock.i18n.getMessage).toHaveBeenCalledWith('welcomeDesc');
      expect(browserMock.i18n.getMessage).toHaveBeenCalledWith('onboardingNext');
      expect(browserMock.i18n.getMessage).toHaveBeenCalledWith('onboardingPrevious');
      expect(browserMock.i18n.getMessage).toHaveBeenCalledWith('onboardingStepProgress', '1');
    });
  });
});
