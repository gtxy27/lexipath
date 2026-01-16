export async function parseSseStream(
  response: Response,
  options: { onData: (data: string) => void; signal?: AbortSignal }
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    if (options.signal?.aborted) break;

    let value: Uint8Array | undefined;
    let done = false;

    try {
      ({ value, done } = await reader.read());
    } catch (error: unknown) {
      if (options.signal?.aborted) break;
      throw error;
    }

    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // SSE frames separate events with a blank line.
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const lines = part.split(/\r?\n/);
      const dataLines: string[] = [];

      for (const line of lines) {
        if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        }
      }

      const data = dataLines.join("\n").trim();
      if (data) options.onData(data);
    }
  }
}
