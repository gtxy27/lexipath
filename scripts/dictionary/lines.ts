import type { Readable } from "node:stream";

export async function* readLinesFromStream(
  stream: Readable,
  options: { encoding?: BufferEncoding } = {},
): AsyncGenerator<string> {
  const encoding = options.encoding ?? "utf8";
  let buffered = "";

  for await (const chunk of stream) {
    buffered += Buffer.isBuffer(chunk) ? chunk.toString(encoding) : String(chunk);
    while (true) {
      const idx = buffered.indexOf("\n");
      if (idx < 0) break;
      const line = buffered.slice(0, idx);
      buffered = buffered.slice(idx + 1);
      yield line.endsWith("\r") ? line.slice(0, -1) : line;
    }
  }

  if (buffered) yield buffered;
}

