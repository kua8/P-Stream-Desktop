/**
 * Input validation and sanitization utilities
 * Provides security-focused validation for URLs, paths, and shell arguments
 */
class InputValidators {
  /**
   * Check if a string is a valid URL
   * @param {string} url - URL to validate
   * @returns {boolean} True if valid URL
   */
  static isValidUrl(url) {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if a URL has an allowed scheme
   * @param {string} url - URL to validate
   * @param {string[]} allowedSchemes - Allowed URL schemes (default: ['http:', 'https:'])
   * @returns {boolean} True if URL scheme is allowed
   */
  static isValidUrlScheme(url, allowedSchemes = ['http:', 'https:']) {
    try {
      const parsed = new URL(url);
      return allowedSchemes.includes(parsed.protocol);
    } catch {
      return false;
    }
  }

  /**
   * Sanitize file path to prevent path traversal attacks
   * @param {string} input - Path to sanitize
   * @returns {string} Sanitized path
   */
  static sanitizePath(input) {
    if (typeof input !== 'string') {
      return '';
    }
    // Remove path traversal patterns and dangerous characters
    return input
      .replace(/\.\.[\/\\]/g, '')  // Remove ../ and ..\
      .replace(/\.\./g, '')         // Remove any remaining ..
      .replace(/[<>:"|?*]/g, '');   // Remove dangerous characters
  }

  /**
   * Sanitize shell argument to prevent command injection
   * @param {string} input - Argument to sanitize
   * @returns {string} Sanitized argument with escaped special characters
   */
  static sanitizeShellArg(input) {
    if (typeof input !== 'string') {
      return '';
    }
    return input.replace(/[;&|`$()]/g, '\\$&');
  }
}

module.exports = InputValidators;
