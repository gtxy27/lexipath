import { createWriteStream } from "node:fs";
import type { Writable } from "node:stream";
import path from "node:path";
import { ensureDir } from "./fs";

export class JsonArrayWriter {
  private output: Writable;
  private first = true;
  private closed = false;
  private count = 0;

  constructor(output: Writable) {
    this.output = output;
    this.output.write("[");
  }

  write(value: unknown): void {
    if (this.closed) throw new Error("JsonArrayWriter is closed");
    const prefix = this.first ? "" : ",";
    this.first = false;
    this.output.write(prefix);
    this.output.write(JSON.stringify(value));
    this.count += 1;
  }

  async close(): Promise<number> {
    if (this.closed) return this.count;
    this.closed = true;
    this.output.write("]");
    await new Promise<void>((resolve, reject) => {
      this.output.end(() => resolve());
      this.output.on("error", reject);
    });
    return this.count;
  }
}

export async function createJsonArrayFileWriter(filePath: string): Promise<{
  writer: JsonArrayWriter;
  close: () => Promise<number>;
}> {
  await ensureDir(path.dirname(filePath));
  const stream = createWriteStream(filePath, { encoding: "utf8" });
  const writer = new JsonArrayWriter(stream);
  return { writer, close: () => writer.close() };
}

