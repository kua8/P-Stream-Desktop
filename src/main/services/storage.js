const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { ValidationError, ServiceError } = require('../utils/errors');
const Logger = require('../utils/logger');
const {
  DEFAULT_STREAM_URL,
  DEFAULT_DISCORD_RPC_ENABLED,
  DEFAULT_WARP_ENABLED,
  DEFAULT_WARP_LAUNCH_ENABLED,
  DEFAULT_HW_ACCEL_ENABLED,
  DEFAULT_VOLUME_BOOST,
  DEFAULT_THEME_COLOR,
  VOLUME_BOOST_MIN,
  VOLUME_BOOST_MAX
} = require('../../shared/constants');

/**
 * Settings schema with validation rules
 */
const SETTINGS_SCHEMA = {
  streamUrl: {
    type: 'string',
    default: DEFAULT_STREAM_URL,
    validate: (value) => typeof value === 'string' && value.length > 0
  },
  discordRPCEnabled: {
    type: 'boolean',
    default: DEFAULT_DISCORD_RPC_ENABLED,
    validate: (value) => typeof value === 'boolean'
  },
  warpEnabled: {
    type: 'boolean',
    default: DEFAULT_WARP_ENABLED,
    validate: (value) => typeof value === 'boolean'
  },
  warpLaunchEnabled: {
    type: 'boolean',
    default: DEFAULT_WARP_LAUNCH_ENABLED,
    validate: (value) => typeof value === 'boolean'
  },
  hardwareAcceleration: {
    type: 'boolean',
    default: DEFAULT_HW_ACCEL_ENABLED,
    validate: (value) => typeof value === 'boolean'
  },
  volumeBoost: {
    type: 'number',
    default: DEFAULT_VOLUME_BOOST,
    validate: (value) => typeof value === 'number' && value >= VOLUME_BOOST_MIN && value <= VOLUME_BOOST_MAX
  },
  themeColor: {
    type: 'string',
    default: DEFAULT_THEME_COLOR,
    validate: (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
  }
};

/**
 * Storage service with improved error handling and validation
 */
class StorageService {
  constructor(options = {}) {
    this.filePath = options.filePath || path.join(app.getPath('userData'), 'settings.json');
    this.logger = options.logger || new Logger();
    this.data = {};
    this.saveTimer = null;
    this.debounceMs = options.debounceMs || 100;
    
    this.load();
  }

  /**
   * Load settings from disk with fallback to defaults
   */
  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const fileData = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(fileData);
        
        if (!this.validateStructure(parsed)) {
          this.logger.warn('Settings file has invalid structure, using defaults');
          this.data = this.getDefaults();
          return;
        }
        
        this.data = { ...this.getDefaults(), ...parsed };
        this.logger.info('Settings loaded successfully');
      } else {
        this.data = this.getDefaults();
        this.logger.info('No settings file found, using defaults');
      }
    } catch (error) {
      this.logger.error('Failed to load settings, falling back to defaults', error);
      this.data = this.getDefaults();
    }
  }

  /**
   * Get default values from schema
   * @returns {Object} Default settings
   */
  getDefaults() {
    const defaults = {};
    for (const [key, schema] of Object.entries(SETTINGS_SCHEMA)) {
      defaults[key] = schema.default;
    }
    return defaults;
  }

  /**
   * Validate settings data structure
   * @param {Object} data - Data to validate
   * @returns {boolean} True if valid
   */
  validateStructure(data) {
    if (!data || typeof data !== 'object') {
      return false;
    }

    for (const [key, value] of Object.entries(data)) {
      const schema = SETTINGS_SCHEMA[key];
      if (!schema) {
        continue;
      }

      if (!schema.validate(value)) {
        this.logger.warn('Invalid value for setting', { key, value });
        return false;
      }
    }

    return true;
  }

  /**
   * Get setting value with type safety
   * @param {string} key - Setting key
   * @param {*} defaultValue - Default value if not found
   * @returns {*} Setting value
   */
  get(key, defaultValue) {
    if (this.data[key] !== undefined) {
      return this.data[key];
    }

    const schema = SETTINGS_SCHEMA[key];
    if (schema) {
      return schema.default;
    }

    return defaultValue;
  }

  /**
   * Set setting value with validation
   * @param {string} key - Setting key
   * @param {*} value - Setting value
   */
  set(key, value) {
    const schema = SETTINGS_SCHEMA[key];
    
    if (schema && !schema.validate(value)) {
      throw new ValidationError(`Invalid value for setting: ${key}`, { key, value });
    }

    this.data[key] = value;
    this.scheduleSave();
  }

  /**
   * Check if setting exists
   * @param {string} key - Setting key
   * @returns {boolean} True if exists
   */
  has(key) {
    return key in this.data;
  }

  /**
   * Delete setting
   * @param {string} key - Setting key
   */
  delete(key) {
    delete this.data[key];
    this.scheduleSave();
  }

  /**
   * Clear all settings and reset to defaults
   */
  clear() {
    this.data = this.getDefaults();
    this.scheduleSave();
  }

  /**
   * Schedule debounced save
   */
  scheduleSave() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }

    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, this.debounceMs);
  }

  /**
   * Save settings to disk atomically
   */
  save() {
    const tempPath = `${this.filePath}.tmp`;
    
    try {
      const data = JSON.stringify(this.data, null, 2);
      
      fs.writeFileSync(tempPath, data, 'utf8');
      
      fs.renameSync(tempPath, this.filePath);
      
      this.logger.debug('Settings saved successfully');
    } catch (error) {
      this.logger.error('Failed to save settings', error);
      
      if (fs.existsSync(tempPath)) {
        try {
          fs.unlinkSync(tempPath);
        } catch (cleanupError) {
          this.logger.error('Failed to clean up temp file', cleanupError);
        }
      }
      
      throw new ServiceError('StorageService', 'Failed to save settings', { error: error.message });
    }
  }

  /**
   * Force immediate save (bypasses debounce)
   */
  saveSync() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.save();
  }
}

module.exports = StorageService;
