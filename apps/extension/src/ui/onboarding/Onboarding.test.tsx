/**
 * @vitest-environment happy-dom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

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
  sendMessageMock: vi.fn(() => Promise.resolve({ ok: true, value: {} })),
}));

vi.mock('webextension-polyfill', () => ({
  default: browserMock,
}));

vi.mock('../../shared/messages', () => ({
  sendMessage: sendMessageMock,
}));

import { Onboarding } from './Onboarding';

describe('Onboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

      const enButton = screen.getByText('languageTarget_en').closest('button');
      expect(enButton).toHaveClass('border-primary-500');
    });

    it('shows CEFR levels for English', () => {
      render(<Onboarding />);

      expect(screen.getByText('proficiency_A1')).toBeInTheDocument();
      expect(screen.getByText('proficiency_A2')).toBeInTheDocument();
      expect(screen.getByText('proficiency_B1')).toBeInTheDocument();
      expect(screen.getByText('proficiency_B2')).toBeInTheDocument();
      expect(screen.getByText('proficiency_C1')).toBeInTheDocument();
      expect(screen.getByText('proficiency_C2')).toBeInTheDocument();
    });

    it('selects B1 by default for English', () => {
      render(<Onboarding />);

      const b1Button = screen.getByText('proficiency_B1').closest('button');
      expect(b1Button).toHaveClass('border-primary-500');
    });

    it('switches to JLPT levels when Japanese is selected', async () => {
      const user = userEvent.setup();
      render(<Onboarding />);

      const jaButton = screen.getByText('languageTarget_ja').closest('button');
      await user.click(jaButton!);

      expect(screen.getByText('proficiency_N5')).toBeInTheDocument();
      expect(screen.getByText('proficiency_N4')).toBeInTheDocument();
      expect(screen.getByText('proficiency_N3')).toBeInTheDocument();
      expect(screen.getByText('proficiency_N2')).toBeInTheDocument();
      expect(screen.getByText('proficiency_N1')).toBeInTheDocument();

      // Should not show CEFR levels
      expect(screen.queryByText('proficiency_A1')).not.toBeInTheDocument();
    });

    it('selects N3 by default when switching to Japanese', async () => {
      const user = userEvent.setup();
      render(<Onboarding />);

      const jaButton = screen.getByText('languageTarget_ja').closest('button');
      await user.click(jaButton!);

      const n3Button = screen.getByText('proficiency_N3').closest('button');
      expect(n3Button).toHaveClass('border-primary-500');
    });

    it('switches to TOPIK levels when Korean is selected', async () => {
      const user = userEvent.setup();
      render(<Onboarding />);

      const koButton = screen.getByText('languageTarget_ko').closest('button');
      await user.click(koButton!);

      expect(screen.getByText('proficiency_TOPIK1')).toBeInTheDocument();
      expect(screen.getByText('proficiency_TOPIK2')).toBeInTheDocument();
      expect(screen.getByText('proficiency_TOPIK3')).toBeInTheDocument();
      expect(screen.getByText('proficiency_TOPIK4')).toBeInTheDocument();
      expect(screen.getByText('proficiency_TOPIK5')).toBeInTheDocument();
      expect(screen.getByText('proficiency_TOPIK6')).toBeInTheDocument();
    });

    it('allows selecting different proficiency levels', async () => {
      const user = userEvent.setup();
      render(<Onboarding />);

      const c1Button = screen.getByText('proficiency_C1').closest('button');
      await user.click(c1Button!);

      expect(c1Button).toHaveClass('border-primary-500');
    });

    it('preserves proficiency selection when switching between CEFR languages', async () => {
      const user = userEvent.setup();
      render(<Onboarding />);

      // Select C1
      const c1Button = screen.getByText('proficiency_C1').closest('button');
      await user.click(c1Button!);

      // Switch to French (also CEFR)
      const frButton = screen.getByText('languageTarget_fr').closest('button');
      await user.click(frButton!);

      // C1 should still be selected
      const c1AfterSwitch = screen.getByText('proficiency_C1').closest('button');
      expect(c1AfterSwitch).toHaveClass('border-primary-500');
    });
  });

  describe('Step 2: Scene Selection', () => {
    it('navigates to step 2 when next is clicked', async () => {
      const user = userEvent.setup();
      render(<Onboarding />);

      const nextButton = screen.getByText('onboardingNext');
      await user.click(nextButton);

      expect(screen.getByText('onboardingStep2Title')).toBeInTheDocument();
      expect(screen.getByText('onboardingStep2Desc')).toBeInTheDocument();
      expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();
    });

    it('renders all scene options', async () => {
      const user = userEvent.setup();
      render(<Onboarding />);

      await user.click(screen.getByText('onboardingNext'));

      expect(screen.getByText('onboardingSceneWebNativeTitle')).toBeInTheDocument();
      expect(screen.getByText('onboardingSceneWebTargetTitle')).toBeInTheDocument();
      expect(screen.getByText('onboardingSceneVideoNativeTitle')).toBeInTheDocument();
      expect(screen.getByText('onboardingSceneVideoTargetTitle')).toBeInTheDocument();
    });

    it('shows scene descriptions', async () => {
      const user = userEvent.setup();
      render(<Onboarding />);

      await user.click(screen.getByText('onboardingNext'));

      expect(screen.getByText('onboardingSceneWebNativeDesc')).toBeInTheDocument();
      expect(screen.getByText('onboardingSceneWebTargetDesc')).toBeInTheDocument();
      expect(screen.getByText('onboardingSceneVideoNativeDesc')).toBeInTheDocument();
      expect(screen.getByText('onboardingSceneVideoTargetDesc')).toBeInTheDocument();
    });

    it('all scenes are enabled by default', async () => {
      const user = userEvent.setup();
      render(<Onboarding />);

      await user.click(screen.getByText('onboardingNext'));

      const sceneCards = screen.getAllByRole('button');
      const enabledCards = sceneCards.filter((card) =>
        card.className.includes('border-primary-500')
      );
      expect(enabledCards.length).toBe(4);
    });

    it('allows toggling scene selections', async () => {
      const user = userEvent.setup();
      render(<Onboarding />);

      await user.click(screen.getByText('onboardingNext'));

      // SceneCard renders a div with the title, find the button by its parent div
      const webNativeTitle = screen.getByText('onboardingSceneWebNativeTitle');
      const webNativeContainer = webNativeTitle.closest('.p-4.rounded-lg.border-2');

      expect(webNativeContainer).not.toBeNull();
      expect(webNativeContainer).toHaveClass('border-primary-500');

      // Find the checkbox button within the container
      const checkboxButton = webNativeContainer?.querySelector('button');
      expect(checkboxButton).not.toBeNull();

      // Click to disable
      await user.click(checkboxButton!);
      expect(webNativeContainer).not.toHaveClass('border-primary-500');
      expect(webNativeContainer).toHaveClass('border-gray-200');

      // Click to re-enable
      await user.click(checkboxButton!);
      expect(webNativeContainer).toHaveClass('border-primary-500');
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
      const user = userEvent.setup();
      render(<Onboarding />);

      await user.click(screen.getByText('onboardingNext'));
      await user.click(screen.getByText('onboardingNext'));

      expect(screen.getByText('onboardingSummaryTargetLanguage')).toBeInTheDocument();
      expect(screen.getByText('onboardingSummaryProficiency')).toBeInTheDocument();
      expect(screen.getByText('languageTarget_en')).toBeInTheDocument();
      expect(screen.getByText('proficiency_B1')).toBeInTheDocument();
    });

    it('shows correct summary for Japanese selection', async () => {
      const user = userEvent.setup();
      render(<Onboarding />);

      // Select Japanese and N2
      const jaButton = screen.getByText('languageTarget_ja').closest('button');
      await user.click(jaButton!);

      const n2Button = screen.getByText('proficiency_N2').closest('button');
      await user.click(n2Button!);

      await user.click(screen.getByText('onboardingNext'));
      await user.click(screen.getByText('onboardingNext'));

      expect(screen.getByText('languageTarget_ja')).toBeInTheDocument();
      expect(screen.getByText('proficiency_N2')).toBeInTheDocument();
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
      const frButton = screen.getByText('languageTarget_fr').closest('button');
      await user.click(frButton!);

      const c2Button = screen.getByText('proficiency_C2').closest('button');
      await user.click(c2Button!);

      // Go to step 2
      await user.click(screen.getByText('onboardingNext'));

      // Disable a scene
      const videoNativeTitle = screen.getByText('onboardingSceneVideoNativeTitle');
      const videoNativeContainer = videoNativeTitle.closest('.p-4.rounded-lg.border-2');
      const videoNativeCheckbox = videoNativeContainer?.querySelector('button');
      await user.click(videoNativeCheckbox!);

      // Go back to step 1
      await user.click(screen.getByText('onboardingPrevious'));

      // Verify selections are preserved
      expect(frButton).toHaveClass('border-primary-500');
      expect(c2Button).toHaveClass('border-primary-500');

      // Go forward to step 2 again
      await user.click(screen.getByText('onboardingNext'));

      // Verify scene selection is preserved
      expect(videoNativeContainer).not.toHaveClass('border-primary-500');
      expect(videoNativeContainer).toHaveClass('border-gray-200');
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
        expect(sendMessageMock).toHaveBeenCalledWith('SET_SETTINGS', {
          targetLanguage: 'en',
          proficiencyLevel: 'B1',
        });
      });
    });

    it('converts JLPT to CEFR when saving', async () => {
      const user = userEvent.setup();
      render(<Onboarding />);

      // Select Japanese N2
      const jaButton = screen.getByText('languageTarget_ja').closest('button');
      await user.click(jaButton!);

      const n2Button = screen.getByText('proficiency_N2').closest('button');
      await user.click(n2Button!);

      await user.click(screen.getByText('onboardingNext'));
      await user.click(screen.getByText('onboardingNext'));
      await user.click(screen.getByText('onboardingFinish'));

      await waitFor(() => {
        expect(sendMessageMock).toHaveBeenCalledWith('SET_SETTINGS', {
          targetLanguage: 'ja',
          proficiencyLevel: 'B2', // N2 maps to B2
        });
      });
    });

    it('converts TOPIK to CEFR when saving', async () => {
      const user = userEvent.setup();
      render(<Onboarding />);

      // Select Korean TOPIK 5
      const koButton = screen.getByText('languageTarget_ko').closest('button');
      await user.click(koButton!);

      const topik5Button = screen.getByText('proficiency_TOPIK5').closest('button');
      await user.click(topik5Button!);

      await user.click(screen.getByText('onboardingNext'));
      await user.click(screen.getByText('onboardingNext'));
      await user.click(screen.getByText('onboardingFinish'));

      await waitFor(() => {
        expect(sendMessageMock).toHaveBeenCalledWith('SET_SETTINGS', {
          targetLanguage: 'ko',
          proficiencyLevel: 'C1', // TOPIK 5 maps to C1
        });
      });
    });

    it('disables finish button while saving', async () => {
      const user = userEvent.setup();
      let resolveSave: (() => void) | undefined;
      sendMessageMock.mockImplementation(
        () =>
          new Promise<{ ok: true; value: {} }>((resolve) => {
            resolveSave = () => resolve({ ok: true, value: {} });
          })
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

      // Ensure sendMessage resolves successfully
      sendMessageMock.mockResolvedValueOnce({ ok: true, value: {} });

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
      sendMessageMock.mockRejectedValue(new Error('Save failed'));

      render(<Onboarding />);

      await user.click(screen.getByText('onboardingNext'));
      await user.click(screen.getByText('onboardingNext'));
      await user.click(screen.getByText('onboardingFinish'));

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          '[LexiPath] Failed to save onboarding settings:',
          expect.any(Error)
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

    it('renders visual progress dots', () => {
      const { container } = render(<Onboarding />);

      // Find the progress indicator container
      const progressContainer = container.querySelector('.flex.items-center.justify-center.gap-2');
      const dots = progressContainer?.querySelectorAll('.h-2.rounded-full');
      expect(dots?.length).toBe(3);
    });
  });

  describe('i18n Integration', () => {
    it('uses browser.i18n.getMessage for all text', () => {
      render(<Onboarding />);

      // Verify key i18n calls (check that they were called at some point)
      expect(browserMock.i18n.getMessage).toHaveBeenCalledWith('welcomeTitle');
      expect(browserMock.i18n.getMessage).toHaveBeenCalledWith('welcomeDesc');
      expect(browserMock.i18n.getMessage).toHaveBeenCalledWith('onboardingNext', undefined);
      expect(browserMock.i18n.getMessage).toHaveBeenCalledWith('onboardingPrevious', undefined);
      expect(browserMock.i18n.getMessage).toHaveBeenCalledWith('onboardingStepProgress', '1');
    });
  });
});
