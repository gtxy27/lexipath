export type ProviderErrorCode =
  | 'NETWORK_ERROR'
  | 'AUTH_ERROR'
  | 'TIMEOUT'
  | 'RATE_LIMIT'
  | 'INVALID_RESPONSE'
  | 'UNKNOWN';

export interface ProviderError {
  code: ProviderErrorCode;
  message: string;
  status?: number;
  retryable: boolean;
}

export function classifyError(error: unknown): ProviderError {
  if (error instanceof Error) {
    if (error.name === 'AbortError') {
      return {
        code: 'TIMEOUT',
        message: 'Request was cancelled or timed out',
        retryable: true,
      };
    }

    if (error.message.includes('401') || error.message.includes('403')) {
      return {
        code: 'AUTH_ERROR',
        message: 'Authentication failed. Please check your API key.',
        retryable: false,
      };
    }

    if (error.message.includes('429')) {
      return {
        code: 'RATE_LIMIT',
        message: 'Rate limit exceeded. Please wait before retrying.',
        retryable: true,
      };
    }

    if (error.message.includes('fetch') || error.message.includes('network')) {
      return {
        code: 'NETWORK_ERROR',
        message: 'Network error. Please check your connection.',
        retryable: true,
      };
    }

    return {
      code: 'UNKNOWN',
      message: error.message,
      retryable: false,
    };
  }

  return {
    code: 'UNKNOWN',
    message: 'An unknown error occurred',
    retryable: false,
  };
}
