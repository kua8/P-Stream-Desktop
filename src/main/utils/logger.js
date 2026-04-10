/**
 * Structured logging utility
 * Provides log levels (debug, info, warn, error) with timestamps and context
 */
class Logger {
  constructor(options = {}) {
    this.level = options.level || 'info';
    this.levels = { debug: 0, info: 1, warn: 2, error: 3 };
  }

  /**
   * Log debug message
   * @param {string} message - Log message
   * @param {Object} context - Additional context
   */
  debug(message, context = {}) {
    this.log('debug', message, context);
  }

  /**
   * Log info message
   * @param {string} message - Log message
   * @param {Object} context - Additional context
   */
  info(message, context = {}) {
    this.log('info', message, context);
  }

  /**
   * Log warning message
   * @param {string} message - Log message
   * @param {Object} context - Additional context
   */
  warn(message, context = {}) {
    this.log('warn', message, context);
  }

  /**
   * Log error message with optional error object
   * @param {string} message - Log message
   * @param {Error} error - Error object
   * @param {Object} context - Additional context
   */
  error(message, error, context = {}) {
    this.log('error', message, { ...context, error: this.formatError(error) });
  }

  /**
   * Core logging method
   * @param {string} level - Log level
   * @param {string} message - Log message
   * @param {Object} context - Additional context
   */
  log(level, message, context) {
    if (this.levels[level] < this.levels[this.level]) return;
    
    const timestamp = new Date().toISOString();
    const formatted = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    
    if (Object.keys(context).length > 0) {
      console.log(formatted, context);
    } else {
      console.log(formatted);
    }
  }

  /**
   * Format error object for logging
   * @param {Error} error - Error object
   * @returns {Object|null} Formatted error
   */
  formatError(error) {
    if (!error) return null;
    return {
      message: error.message,
      stack: error.stack,
      code: error.code
    };
  }
}

module.exports = Logger;
