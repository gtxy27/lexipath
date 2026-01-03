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

  it('appends original text in parentheses for native-to-target mode', () => {
    const fragment = createEnhancedElement(
      '你好 世界',
      {
        content_result: '',
        convert_word: [{ original: '你好', converted: 'hello' }],
      },
      'native-to-target'
    );

    const wrapper = document.createElement('div');
    wrapper.appendChild(fragment);
    const span = wrapper.querySelector('span.lexipath-word');
    expect(span?.textContent).toBe('hello (你好)');
  });
});
