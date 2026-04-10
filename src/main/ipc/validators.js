const { ValidationError } = require('../utils/errors');

/**
 * Validates IPC message payloads
 * 
 * Validates: Requirements 8.2, 8.5
 * 
 * Expected payload structures:
 * 
 * makeRequest:
 *   - url: string (required) - URL or path to request
 *   - baseUrl: string (optional) - Base URL to prepend
 *   - method: string (optional) - HTTP method (GET, POST, etc.)
 *   - headers: object (optional) - Request headers
 *   - body: any (optional) - Request body
 *   - bodyType: string (optional) - Body type (FormData, URLSearchParams, object, string)
 *   - query: object (optional) - Query parameters
 * 
 * prepareStream:
 *   - ruleId: string (required) - Unique identifier for the CORS bypass rule
 *   - targetDomains: string[] (optional) - List of target domains
 *   - targetRegex: string (optional) - Regex pattern for target URLs
 *   - requestHeaders: object (optional) - Headers to add to requests
 *   - responseHeaders: object (optional) - Headers to add to responses
 */
class PayloadValidators {
  /**
   * Validate makeRequest payload
   * @param {Object} payload - Request payload
   * @throws {ValidationError} If payload is invalid
   */
  validateMakeRequest(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new ValidationError('Invalid payload: must be an object', {
        received: typeof payload
      });
    }

    if (!payload.url || typeof payload.url !== 'string') {
      throw new ValidationError('Invalid payload: url must be a non-empty string', {
        received: typeof payload.url
      });
    }

    if (payload.baseUrl !== undefined && typeof payload.baseUrl !== 'string') {
      throw new ValidationError('Invalid payload: baseUrl must be a string', {
        received: typeof payload.baseUrl
      });
    }

    if (payload.method !== undefined && typeof payload.method !== 'string') {
      throw new ValidationError('Invalid payload: method must be a string', {
        received: typeof payload.method
      });
    }

    if (payload.headers !== undefined && (typeof payload.headers !== 'object' || Array.isArray(payload.headers))) {
      throw new ValidationError('Invalid payload: headers must be an object', {
        received: typeof payload.headers
      });
    }

    if (payload.bodyType !== undefined) {
      const validBodyTypes = ['FormData', 'URLSearchParams', 'object', 'string'];
      if (!validBodyTypes.includes(payload.bodyType)) {
        throw new ValidationError('Invalid payload: bodyType must be one of: FormData, URLSearchParams, object, string', {
          received: payload.bodyType,
          valid: validBodyTypes
        });
      }
    }

    if (payload.query !== undefined && (typeof payload.query !== 'object' || Array.isArray(payload.query))) {
      throw new ValidationError('Invalid payload: query must be an object', {
        received: typeof payload.query
      });
    }
  }

  /**
   * Validate prepareStream payload
   * @param {Object} payload - Stream preparation payload
   * @throws {ValidationError} If payload is invalid
   */
  validatePrepareStream(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new ValidationError('Invalid payload: must be an object', {
        received: typeof payload
      });
    }

    if (!payload.ruleId || typeof payload.ruleId !== 'string') {
      throw new ValidationError('Invalid payload: ruleId must be a non-empty string', {
        received: typeof payload.ruleId
      });
    }

    if (payload.targetDomains !== undefined) {
      if (!Array.isArray(payload.targetDomains)) {
        throw new ValidationError('Invalid payload: targetDomains must be an array', {
          received: typeof payload.targetDomains
        });
      }

      for (const domain of payload.targetDomains) {
        if (typeof domain !== 'string') {
          throw new ValidationError('Invalid payload: targetDomains must contain only strings', {
            received: typeof domain
          });
        }
      }
    }

    if (payload.targetRegex !== undefined && typeof payload.targetRegex !== 'string') {
      throw new ValidationError('Invalid payload: targetRegex must be a string', {
        received: typeof payload.targetRegex
      });
    }

    if (payload.requestHeaders !== undefined && (typeof payload.requestHeaders !== 'object' || Array.isArray(payload.requestHeaders))) {
      throw new ValidationError('Invalid payload: requestHeaders must be an object', {
        received: typeof payload.requestHeaders
      });
    }

    if (payload.responseHeaders !== undefined && (typeof payload.responseHeaders !== 'object' || Array.isArray(payload.responseHeaders))) {
      throw new ValidationError('Invalid payload: responseHeaders must be an object', {
        received: typeof payload.responseHeaders
      });
    }
  }

  /**
   * Validate openPage payload
   * @param {Object} payload - Open page payload
   * @throws {ValidationError} If payload is invalid
   */
  validateOpenPage(payload) {
    if (payload === undefined || payload === null) {
      return;
    }

    if (typeof payload !== 'object') {
      throw new ValidationError('Invalid payload: must be an object', {
        received: typeof payload
      });
    }

    if (payload.page !== undefined && typeof payload.page !== 'string') {
      throw new ValidationError('Invalid payload: page must be a string', {
        received: typeof payload.page
      });
    }
  }
}

module.exports = PayloadValidators;
