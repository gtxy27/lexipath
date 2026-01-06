export class SubtitleHttpError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly url: string;

  constructor(message: string, options: { status: number; statusText: string; url: string }) {
    super(message);
    this.name = 'SubtitleHttpError';
    this.status = options.status;
    this.statusText = options.statusText;
    this.url = options.url;
  }
}

