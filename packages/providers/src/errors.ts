export type ProviderErrorCode =
  | 'NETWORK_ERROR'
  | 'AUTH_ERROR'
  | 'TIMEOUT'
  | 'RATE_LIMIT'
  | 'INVALID_RESPONSE'
  | 'INVALID_REQUEST'
  | 'SERVER_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'QUOTA_EXCEEDED'
  | 'MODEL_NOT_FOUND'
  | 'CONTEXT_LENGTH_EXCEEDED'
  | 'UNKNOWN';

export interface ProviderError {
  code: ProviderErrorCode;
  message: string;
  status?: number;
  retryable: boolean;
}

/**
 * Classify error into structured ProviderError.
 * Determines error code, user-friendly message, and whether retry is appropriate.
 */
export function classifyError(error: unknown): ProviderError {
  if (error instanceof Error) {
    const status = (error as any).status;

    if (error.name === 'AbortError') {
      return {
        code: 'TIMEOUT',
        message: 'Request was cancelled or timed out',
        status,
        retryable: true,
      };
    }

    if (status !== undefined) {
      return classifyHttpError(status, error.message);
    }

    if (error.message.includes('Failed to fetch') ||
        error.message.includes('network') ||
        error.message.includes('NetworkError')) {
      return {
        code: 'NETWORK_ERROR',
        message: 'Network error. Please check your connection.',
        retryable: true,
      };
    }

    if (error.message.includes('JSON') || error.message.includes('parse')) {
      return {
        code: 'INVALID_RESPONSE',
        message: 'Invalid response from provider. Please check your configuration.',
        retryable: false,
      };
    }

    if (error.message.includes('context_length') ||
        error.message.includes('maximum context length')) {
      return {
        code: 'CONTEXT_LENGTH_EXCEEDED',
        message: 'Input text is too long for the model. Please reduce the content size.',
        retryable: false,
      };
    }

    if (error.message.includes('model') && error.message.includes('not found')) {
      return {
        code: 'MODEL_NOT_FOUND',
        message: 'Model not found. Please check your model configuration.',
        retryable: false,
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

/**
 * Classify HTTP status code errors.
 */
function classifyHttpError(status: number, message: string): ProviderError {
  if (status === 400) {
    return {
      code: 'INVALID_REQUEST',
      message: 'Invalid request. Please check your input parameters.',
      status,
      retryable: false,
    };
  }

  if (status === 401) {
    return {
      code: 'AUTH_ERROR',
      message: 'Authentication failed. Please check your API key.',
      status,
      retryable: false,
    };
  }

  if (status === 403) {
    return {
      code: 'AUTH_ERROR',
      message: 'Access forbidden. Your API key may lack required permissions.',
      status,
      retryable: false,
    };
  }

  if (status === 404) {
    return {
      code: 'MODEL_NOT_FOUND',
      message: 'Resource not found. Please check your endpoint and model name.',
      status,
      retryable: false,
    };
  }

  if (status === 429) {
    return {
      code: 'RATE_LIMIT',
      message: 'Rate limit exceeded. Please wait before retrying.',
      status,
      retryable: true,
    };
  }

  if (status === 500) {
    return {
      code: 'SERVER_ERROR',
      message: 'Provider server error. This is usually temporary.',
      status,
      retryable: true,
    };
  }

  if (status === 502 || status === 503) {
    return {
      code: 'SERVICE_UNAVAILABLE',
      message: 'Service temporarily unavailable. Please try again later.',
      status,
      retryable: true,
    };
  }

  if (status === 504) {
    return {
      code: 'TIMEOUT',
      message: 'Gateway timeout. The request took too long to process.',
      status,
      retryable: true,
    };
  }

  if (status >= 400 && status < 500) {
    return {
      code: 'INVALID_REQUEST',
      message: `Client error: ${message}`,
      status,
      retryable: false,
    };
  }

  if (status >= 500) {
    return {
      code: 'SERVER_ERROR',
      message: `Server error: ${message}`,
      status,
      retryable: true,
    };
  }

  return {
    code: 'UNKNOWN',
    message: message || `HTTP error ${status}`,
    status,
    retryable: false,
  };
}
