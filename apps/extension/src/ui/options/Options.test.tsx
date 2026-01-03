/**
 * @vitest-environment happy-dom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

const { browserMock, sendMessageMock, defaultSettings } = vi.hoisted(() => {
  const settings = {
    nativeLanguage: 'zh-CN',
    targetLanguage: 'en',
    proficiencyLevel: 'B1',
    channels: {},
    keywordProvider: 'openai',
    translationProvider: 'openai',
    channelConcurrencyLimits: {},
    enabled: true,
    autoEnhance: true,
    siteMode: 'all',
    excludedSites: [],
    allowedSites: [],
  } as const;
  return {
    defaultSettings: settings,
    browserMock: {
      i18n: {
        getMessage: vi.fn((key: string) => key),
      },
    },
    sendMessageMock: vi.fn(async (type: string, payload: unknown) => {
      if (type === 'GET_SETTINGS') return { ok: true, value: settings };
      if (type === 'SET_SETTINGS') return { ok: true, value: null };
      if (type === 'TEST_PROVIDER_CONNECTION') return { ok: true, value: true };
      return { ok: true, value: null };
    }),
  };
});

vi.mock('webextension-polyfill', () => ({
  default: browserMock,
}));

vi.mock('../../shared/messages', () => ({
  sendMessage: sendMessageMock,
}));

import { Options } from './Options';

describe('Options', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders routing selectors after loading settings', async () => {
    render(<Options />);

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith('GET_SETTINGS', undefined);
    });

    expect(screen.getByText('optionsRoutingTitle')).toBeInTheDocument();
    expect(screen.getByLabelText('optionsKeywordProviderLabel')).toBeInTheDocument();
    expect(screen.getByLabelText('optionsTranslationProviderLabel')).toBeInTheDocument();
  });

  it('saves OpenAI config + routing + concurrency', async () => {
    render(<Options />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith('GET_SETTINGS', undefined);
    });

    await user.type(
      screen.getByLabelText(/optionsProviderBaseUrlLabel/, { selector: '#openai-base-url' }),
      'https://api.openai.com/v1'
    );
    await user.type(
      screen.getByLabelText(/optionsProviderModelLabel/, { selector: '#openai-model' }),
      'gpt-4o-mini'
    );

    await user.selectOptions(
      screen.getByLabelText('optionsTranslationProviderLabel'),
      'google'
    );

    await user.type(
      screen.getByLabelText('optionsConcurrencyChannel_google', { selector: '#concurrency-google' }),
      '5'
    );

    await user.click(screen.getByRole('button', { name: 'optionsSaveButton' }));

    const setCalls = sendMessageMock.mock.calls.filter((call) => call[0] === 'SET_SETTINGS');
    expect(setCalls).toHaveLength(1);

    const payload = setCalls[0]?.[1] as any;
    expect(payload.channels.openai.baseUrl).toBe('https://api.openai.com/v1');
    expect(payload.channels.openai.model).toBe('gpt-4o-mini');
    expect(payload.keywordProvider).toBe(defaultSettings.keywordProvider);
    expect(payload.translationProvider).toBe('google');
    expect(payload.channelConcurrencyLimits.google).toBe(5);
  });

  it('tests Google Translate via TEST_PROVIDER_CONNECTION', async () => {
    render(<Options />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith('GET_SETTINGS', undefined);
    });

    await user.click(screen.getByRole('button', { name: 'optionsTestGoogleTranslate' }));

    const calls = sendMessageMock.mock.calls.filter((call) => call[0] === 'TEST_PROVIDER_CONNECTION');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]).toEqual({ type: 'google' });
  });
});
