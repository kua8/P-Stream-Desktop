/**
 * Base application error with error codes and context
 */
class AppError extends Error {
  constructor(message, code, context = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.context = context;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      context: this.context,
      stack: this.stack
    };
  }
}

/**
 * Network-related errors
 */
class NetworkError extends AppError {
  constructor(message, context = {}) {
    super(message, 'NETWORK_ERROR', context);
  }
}

/**
 * Validation errors
 */
class ValidationError extends AppError {
  constructor(message, context = {}) {
    super(message, 'VALIDATION_ERROR', context);
  }
}

/**
 * Service errors
 */
class ServiceError extends AppError {
  constructor(service, message, context = {}) {
    super(message, 'SERVICE_ERROR', { ...context, service });
  }
}

module.exports = {
  AppError,
  NetworkError,
  ValidationError,
  ServiceError
};
