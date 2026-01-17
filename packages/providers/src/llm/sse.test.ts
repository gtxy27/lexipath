import { describe, expect, it, vi } from 'vitest';

import { parseSseStream } from './sse';

type ReaderResult = { value?: Uint8Array; done: boolean };

type FakeReader = {
  read: () => Promise<ReaderResult>;
};

function createReaderFromStrings(chunks: string[]): FakeReader {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    read: async () => {
      if (i >= chunks.length) return { done: true };
      const value = encoder.encode(chunks[i] ?? '');
      i += 1;
      return { value, done: false };
    },
  };
}

function createResponseWithReader(reader: FakeReader): Response {
  return {
    body: {
      getReader: () => reader as any,
    },
  } as unknown as Response;
}

describe('parseSseStream', () => {
  it('returns when response has no body', async () => {
    const onData = vi.fn();
    await parseSseStream({ body: undefined } as unknown as Response, { onData });
    expect(onData).not.toHaveBeenCalled();
  });

  it('emits data events and joins multiple data lines', async () => {
    const onData = vi.fn();
    const reader = createReaderFromStrings(['data: one\n\n', 'data: a\ndata: b\n\n']);
    await parseSseStream(createResponseWithReader(reader), { onData });

    expect(onData).toHaveBeenCalledTimes(2);
    expect(onData).toHaveBeenNthCalledWith(1, 'one');
    expect(onData).toHaveBeenNthCalledWith(2, 'a\nb');
  });

  it('ignores non-data fields and supports CRLF', async () => {
    const onData = vi.fn();
    const reader = createReaderFromStrings(['event: msg\r\nid: 1\r\ndata: hi\r\n\r\n']);
    await parseSseStream(createResponseWithReader(reader), { onData });

    expect(onData).toHaveBeenCalledTimes(1);
    expect(onData).toHaveBeenCalledWith('hi');
  });

  it('handles chunk boundaries across events', async () => {
    const onData = vi.fn();
    const reader = createReaderFromStrings(['data: hel', 'lo\n\n']);
    await parseSseStream(createResponseWithReader(reader), { onData });

    expect(onData).toHaveBeenCalledTimes(1);
    expect(onData).toHaveBeenCalledWith('hello');
  });

  it('does not emit when final frame is incomplete', async () => {
    const onData = vi.fn();
    const reader = createReaderFromStrings(['data: hi']);
    await parseSseStream(createResponseWithReader(reader), { onData });

    expect(onData).not.toHaveBeenCalled();
  });

  it('exits immediately when already aborted', async () => {
    const onData = vi.fn();
    const read = vi.fn(async () => ({ done: false, value: new Uint8Array() }));
    const reader: FakeReader = { read };

    const ac = new AbortController();
    ac.abort();

    await parseSseStream(createResponseWithReader(reader), { onData, signal: ac.signal });

    expect(read).not.toHaveBeenCalled();
    expect(onData).not.toHaveBeenCalled();
  });

  it('swallows read errors when aborted during read', async () => {
    const onData = vi.fn();

    const ac = new AbortController();
    const reader: FakeReader = {
      read: () =>
        new Promise((_resolve, reject) => {
          queueMicrotask(() => reject(new Error('boom')));
        }),
    };

    const promise = parseSseStream(createResponseWithReader(reader), { onData, signal: ac.signal });
    ac.abort();

    await expect(promise).resolves.toBeUndefined();
    expect(onData).not.toHaveBeenCalled();
  });
});
