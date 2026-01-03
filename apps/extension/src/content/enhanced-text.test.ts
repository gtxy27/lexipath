/**
 * @vitest-environment happy-dom
 */

import { describe, expect, it } from 'vitest';
import { createEnhancedElement } from './enhanced-text';

describe('createEnhancedElement', () => {
  it('highlights repeated word occurrences', () => {
    const fragment = createEnhancedElement(
      'test and test again',
      {
        content_result: '',
        convert_word: [{ original: 'test', converted: '测试' }],
      },
      'target-to-native'
    );

    const wrapper = document.createElement('div');
    wrapper.appendChild(fragment);
    const spans = wrapper.querySelectorAll('span.lexipath-word');
    expect(spans).toHaveLength(2);
    expect(spans[0]?.textContent).toBe('test');
    expect(spans[1]?.textContent).toBe('test');
  });

  it('does not highlight substrings inside other words', () => {
    const fragment = createEnhancedElement(
      'the hero',
      {
        content_result: '',
        convert_word: [{ original: 'he', converted: '他' }],
      },
      'target-to-native'
    );

    const wrapper = document.createElement('div');
    wrapper.appendChild(fragment);
    expect(wrapper.querySelector('span.lexipath-word')).toBeNull();
  });
});

