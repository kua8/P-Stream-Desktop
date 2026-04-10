/**
 * Retry utility with exponential backoff
 * 
 * @param {Function} fn - Async function to execute
 * @param {Object} options - Retry configuration options
 * @param {number} options.maxAttempts - Maximum number of attempts (default: 3)
 * @param {number} options.delay - Initial delay in milliseconds (default: 1000)
 * @param {number} options.backoff - Backoff multiplier (default: 2)
 * @returns {Promise<*>} Result of the function execution
 * @throws {Error} Last error if all attempts fail
 * 
 */
async function withRetry(fn, options = {}) {
  const maxAttempts = options.maxAttempts || 3;
  const delay = options.delay || 1000;
  const backoff = options.backoff || 2;
  
  let lastError;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt < maxAttempts) {
        const waitTime = delay * Math.pow(backoff, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }
  
  throw lastError;
}

module.exports = {
  withRetry
};
