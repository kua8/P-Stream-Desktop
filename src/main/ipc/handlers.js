const { shell, session } = require('electron');
const { ValidationError, NetworkError } = require('../utils/errors');
const PayloadValidators = require('./validators');

/**
 * Centralized IPC handler registration and management
 * Provides consistent response format, logging, and error handling
 * 
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5
 */
class IPCHandlers {
  constructor(dependencies) {
    this.services = dependencies.services || {};
    this.logger = dependencies.logger;
    this.ipcMain = dependencies.ipcMain;
    this.validators = new PayloadValidators();
    
    this.hostsWithCookiesAccess = [
      /^(?:.*\.)?ee3\.me$/,
      /^(?:.*\.)?rips\.cc$/,
      /^(?:.*\.)?m4ufree\.(?:tv|to|pw)$/,
      /^(?:.*\.)?goojara\.to$/,
      /^(?:.*\.)?levidia\.ch$/,
      /^(?:.*\.)?wootly\.ch$/,
      /^(?:.*\.)?multimovies\.(?:sbs|online|cloud)$/,
    ];
    
    this.modifiableResponseHeaders = new Set([
      'access-control-allow-origin',
      'access-control-allow-methods',
      'access-control-allow-headers',
      'content-security-policy',
      'content-security-policy-report-only',
      'content-disposition',
    ]);
    
    this.activeRules = new Map();
  }

  /**
   * Register all IPC handlers
   */
  register() {
    this.ipcMain.handle('hello', this.wrapHandler(this.handleHello.bind(this)));
    this.ipcMain.handle('openPage', this.wrapHandler(this.handleOpenPage.bind(this)));
    this.ipcMain.handle('prepareStream', this.wrapHandler(this.handlePrepareStream.bind(this)));
    this.ipcMain.handle('makeRequest', this.wrapHandler(this.handleMakeRequest.bind(this)));
  }

  /**
   * Wrap handler with logging and error handling
   * @param {Function} handler - Handler function
   * @returns {Function} Wrapped handler
   */
  wrapHandler(handler) {
    return async (event, payload) => {
      const handlerName = handler.name || 'unknown';
      
      try {
        this.logger.debug(`IPC handler called: ${handlerName}`, {
          hasPayload: !!payload
        });
        
        const result = await handler(event, payload);
        
        this.logger.debug(`IPC handler succeeded: ${handlerName}`);
        
        return { success: true, data: result };
      } catch (error) {
        this.logger.error(`IPC handler failed: ${handlerName}`, error, {
          payload: payload ? JSON.stringify(payload).substring(0, 200) : 'none',
          errorCode: error.code,
          errorContext: error.context
        });
        
        return {
          success: false,
          error: {
            message: error.message,
            code: error.code || 'UNKNOWN_ERROR',
            context: error.context || {}
          }
        };
      }
    };
  }

  /**
   * Handle hello request
   */
  async handleHello(event, payload) {
    this.logger.debug('IPC: hello');
    
    return {
      version: '1.3.7',
      type: 'desktop',
      allowed: true,
      hasPermission: true,
    };
  }

  /**
   * Handle openPage request
   */
  async handleOpenPage(event, payload) {
    this.validators.validateOpenPage(payload);
    
    this.logger.debug('IPC: openPage', { page: payload?.page });
    
    if (payload && payload.page) {
      this.logger.info('Request to openPage', { page: payload.page });
    }
    
    return {};
  }

  /**
   * Handle prepareStream request
   */
  async handlePrepareStream(event, payload) {
    this.validators.validatePrepareStream(payload);
    
    this.logger.debug('IPC: prepareStream', { ruleId: payload.ruleId });

    const filteredResponseHeaders = {};
    if (payload.responseHeaders) {
      Object.keys(payload.responseHeaders).forEach((key) => {
        if (this.modifiableResponseHeaders.has(key.toLowerCase())) {
          filteredResponseHeaders[key] = payload.responseHeaders[key];
        }
      });
    }
    payload.responseHeaders = filteredResponseHeaders;

    this.updateRule(payload);
    
    return {};
  }

  /**
   * Handle makeRequest request
   */
  async handleMakeRequest(event, payload) {
    this.validators.validateMakeRequest(payload);
    
    this.logger.debug('IPC: makeRequest', { url: payload.url });

    const url = this.getMakeFullUrl(payload.url, payload);
    const method = payload.method || 'GET';
    const headers = payload.headers || {};

    const fetchOptions = {
      method,
      headers,
      body: this.mapBodyToFetchBody(payload.body, payload.bodyType),
    };

    let response;
    try {
      response = await fetch(url, fetchOptions);
    } catch (error) {
      this.logger.error('Network request failed', error, {
        url,
        method,
        errorMessage: error.message
      });
      
      throw new NetworkError('Failed to fetch URL', {
        url,
        method,
        originalError: error.message
      });
    }

    const contentType = response.headers.get('content-type');
    let responseBody;
    
    try {
      responseBody = contentType && contentType.includes('application/json')
        ? await response.json()
        : await response.text();
    } catch (error) {
      this.logger.warn('Failed to parse response body', {
        url,
        contentType,
        error: error.message
      });
      
      responseBody = null;
    }

    let cookies = [];
    try {
      cookies = await session.defaultSession.cookies.get({ url: response.url });
    } catch (error) {
      this.logger.warn('Failed to retrieve cookies', {
        url: response.url,
        error: error.message
      });
    }

    const responseHeaders = {};
    response.headers.forEach((val, key) => {
      responseHeaders[key] = val;
    });

    const hostname = new URL(url).hostname;
    if (this.canAccessCookies(hostname)) {
      responseHeaders['Set-Cookie'] = cookies.map((c) => `${c.name}=${c.value}`).join(', ');
      responseHeaders['Access-Control-Allow-Credentials'] = 'true';
    }

    this.logger.info('Request completed successfully', {
      url,
      statusCode: response.status,
      finalUrl: response.url
    });

    return {
      statusCode: response.status,
      headers: responseHeaders,
      finalUrl: response.url,
      body: responseBody,
    };
  }

  /**
   * Check if host can access cookies
   * @param {string} host - Hostname
   * @returns {boolean} Can access cookies
   */
  canAccessCookies(host) {
    return this.hostsWithCookiesAccess.some((regex) => regex.test(host));
  }

  /**
   * Compile regex pattern
   * @param {string} pattern - Regex pattern
   * @returns {RegExp|null} Compiled regex
   */
  compileRegex(pattern) {
    if (!pattern || typeof pattern !== 'string') return null;
    try {
      return new RegExp(pattern);
    } catch {
      return null;
    }
  }

  /**
   * Normalize target domains
   * @param {string[]} domains - Domain list
   * @returns {string[]|null} Normalized domains
   */
  normalizeTargetDomains(domains) {
    if (!Array.isArray(domains)) return null;
    return domains.map((domain) => domain.toLowerCase());
  }

  /**
   * Update CORS bypass rule
   * @param {Object} rule - Rule object
   */
  updateRule(rule) {
    const updatedRule = { ...rule };
    updatedRule.__compiledTargetRegex = this.compileRegex(rule.targetRegex);
    updatedRule.__normalizedTargetDomains = this.normalizeTargetDomains(rule.targetDomains);
    this.activeRules.set(rule.ruleId, updatedRule);
  }

  /**
   * Remove CORS bypass rule
   * @param {string} ruleId - Rule ID
   */
  removeRule(ruleId) {
    this.activeRules.delete(ruleId);
  }

  /**
   * Get matching CORS bypass rules
   * @param {string} url - Request URL
   * @param {string} hostname - Request hostname
   * @returns {Object[]} Matching rules
   */
  getMatchingRules(url, hostname) {
    if (this.activeRules.size === 0) return [];
    const hostnameLower = hostname ? hostname.toLowerCase() : null;
    const matches = [];

    for (const rule of this.activeRules.values()) {
      let match = false;
      if (hostnameLower && rule.__normalizedTargetDomains) {
        if (rule.__normalizedTargetDomains.some((domain) => hostnameLower.includes(domain))) {
          match = true;
        }
      }
      if (!match && rule.__compiledTargetRegex && rule.__compiledTargetRegex.test(url)) {
        match = true;
      }
      if (match) matches.push(rule);
    }

    return matches;
  }

  /**
   * Construct full URL from parts
   * @param {string} url - URL or path
   * @param {Object} body - Request body with baseUrl and query
   * @returns {string} Full URL
   */
  getMakeFullUrl(url, body) {
    let leftSide = body && body.baseUrl ? body.baseUrl : '';
    let rightSide = url;

    if (leftSide.length > 0 && !leftSide.endsWith('/')) leftSide += '/';
    if (rightSide.startsWith('/')) rightSide = rightSide.slice(1);

    const fullUrl = leftSide + rightSide;
    const u = new URL(fullUrl);

    if (body && body.query) {
      Object.entries(body.query).forEach(([key, val]) => {
        u.searchParams.append(key, val);
      });
    }
    return u.toString();
  }

  /**
   * Map body to fetch body format
   * @param {*} body - Body data
   * @param {string} bodyType - Body type
   * @returns {*} Formatted body
   */
  mapBodyToFetchBody(body, bodyType) {
    if (bodyType === 'FormData') {
      const formData = new FormData();
      if (Array.isArray(body)) {
        body.forEach(([key, value]) => {
          formData.append(key, value.toString());
        });
      } else if (typeof body === 'object') {
        Object.entries(body).forEach(([key, value]) => {
          formData.append(key, value.toString());
        });
      }
      return formData;
    }
    if (bodyType === 'URLSearchParams') {
      return new URLSearchParams(body);
    }
    if (bodyType === 'object') {
      return JSON.stringify(body);
    }
    if (bodyType === 'string') {
      return body;
    }
    return body;
  }

  /**
   * Setup network interceptors for CORS bypass
   * @param {Electron.Session} sess - Electron session
   * @param {Object} options - Options with getStreamHostname function
   */
  setupInterceptors(sess, options = {}) {
    const filter = { urls: ['<all_urls>'] };

    sess.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
      let requestHeaders = details.requestHeaders;
      let parsedHostname = null;
      try {
        parsedHostname = new URL(details.url).hostname;
      } catch {
        parsedHostname = null;
      }

      const getStreamHostname = options.getStreamHostname;
      if (typeof getStreamHostname === 'function' && parsedHostname) {
        try {
          const streamHostname = getStreamHostname();
          if (streamHostname) {
            const requestHostname = parsedHostname.replace(/^www\./, '');
            if (requestHostname === streamHostname.replace(/^www\./, '')) {
              requestHeaders['X-P-Stream-Client'] = 'desktop';
            }
          }
        } catch (_) {
          // Ignore URL parse errors
        }
      }

      const matchingRules = this.getMatchingRules(details.url, parsedHostname);
      for (const rule of matchingRules) {
        if (rule.requestHeaders) {
          Object.entries(rule.requestHeaders).forEach(([name, value]) => {
            requestHeaders[name] = value;
          });
        }
      }

      callback({ requestHeaders: requestHeaders });
    });

    sess.webRequest.onHeadersReceived(filter, (details, callback) => {
      let responseHeaders = { ...details.responseHeaders };

      let parsedHostname = null;
      try {
        parsedHostname = new URL(details.url).hostname;
      } catch {
        parsedHostname = null;
      }

      const ruleMatches = this.getMatchingRules(details.url, parsedHostname);

      if (ruleMatches.length > 0) {
        const removeHeader = (name) => {
          const lowerName = name.toLowerCase();
          Object.keys(responseHeaders).forEach((key) => {
            if (key.toLowerCase() === lowerName) {
              delete responseHeaders[key];
            }
          });
        };

        ruleMatches.forEach((rule) => {
          if (rule.responseHeaders) {
            Object.entries(rule.responseHeaders).forEach(([name, value]) => {
              removeHeader(name);
              responseHeaders[name] = [value];
            });
          }
        });

        removeHeader('Access-Control-Allow-Origin');
        removeHeader('Access-Control-Allow-Methods');
        removeHeader('Access-Control-Allow-Headers');
        removeHeader('Access-Control-Allow-Credentials');

        responseHeaders['Access-Control-Allow-Origin'] = ['*'];
        responseHeaders['Access-Control-Allow-Methods'] = ['GET, POST, PUT, DELETE, PATCH, OPTIONS'];
        responseHeaders['Access-Control-Allow-Headers'] = ['*'];
      }

      callback({ responseHeaders: responseHeaders });
    });
  }
}

module.exports = IPCHandlers;
