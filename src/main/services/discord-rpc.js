const DiscordRPC = require('discord-rpc');
const { ServiceError } = require('../utils/errors');
const {
  DISCORD_CLIENT_ID,
  DISCORD_ACTIVITY_TYPE_WATCHING,
  DISCORD_LOGIN_RETRY_MS,
  DISCORD_ERROR_LOG_THROTTLE_MS,
  DEFAULT_DISCORD_RPC_ENABLED,
} = require('../../shared/constants');

/**
 * Connection states for Discord RPC
 */
const ConnectionState = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  READY: 'ready',
};

/**
 * Discord Rich Presence Service
 * Manages Discord RPC integration with exponential backoff and graceful error handling
 */
class DiscordRPCService {
  constructor(dependencies) {
    this.store = dependencies.store;
    this.logger = dependencies.logger;
    
    this.client = null;
    this.state = ConnectionState.DISCONNECTED;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.baseRetryDelay = DISCORD_LOGIN_RETRY_MS;
    this.lastErrorLog = 0;
    this.errorLogThrottle = DISCORD_ERROR_LOG_THROTTLE_MS;
    this.loginInFlight = false;
    
    this.currentMediaMetadata = null;
    this.currentActivityTitle = null;
  }

  /**
   * Initialize the Discord RPC service
   */
  async initialize() {
    try {
      DiscordRPC.register(DISCORD_CLIENT_ID);
      
      this.client = new DiscordRPC.Client({ transport: 'ipc' });
      
      this.client.on('ready', () => this._handleReady());
      this.client.on('disconnected', () => this._handleDisconnected());
      
      await this.connect();
    } catch (error) {
      this.logger.error('Failed to initialize Discord RPC', error);
      throw new ServiceError('DiscordRPC', 'Initialization failed', { error: error.message });
    }
  }

  /**
   * Connect to Discord with exponential backoff
   */
  async connect() {
    if (!this.client || this.loginInFlight) {
      return false;
    }

    if (this.state === ConnectionState.READY) {
      return true;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this._logError('Max reconnection attempts reached', null);
      return false;
    }

    this.loginInFlight = true;
    this.state = ConnectionState.CONNECTING;

    try {
      await this.client.login({ clientId: DISCORD_CLIENT_ID });
      this.reconnectAttempts = 0;
      this.loginInFlight = false;
      return true;
    } catch (error) {
      this.loginInFlight = false;
      this.state = ConnectionState.DISCONNECTED;
      this.reconnectAttempts++;
      
      this._logError('Connection failed', error);
      
      const delay = this._getBackoffDelay();
      this.logger.debug('Scheduling reconnect', { 
        attempt: this.reconnectAttempts, 
        delayMs: delay 
      });
      
      setTimeout(() => this.connect(), delay);
      
      return false;
    }
  }

  /**
   * Calculate exponential backoff delay
   */
  _getBackoffDelay() {
    const exponentialDelay = this.baseRetryDelay * Math.pow(2, this.reconnectAttempts - 1);
    const maxDelay = 5 * 60 * 1000;
    return Math.min(exponentialDelay, maxDelay);
  }

  /**
   * Handle ready event
   */
  _handleReady() {
    this.state = ConnectionState.READY;
    this.reconnectAttempts = 0;
    this.logger.info('Discord RPC connected');
    
    if (this._isEnabled()) {
      this.updateActivity(this.currentMediaMetadata);
    }
  }

  /**
   * Handle disconnected event
   */
  _handleDisconnected() {
    this.state = ConnectionState.DISCONNECTED;
    this.logger.warn('Discord RPC disconnected');
  }

  /**
   * Check if RPC is enabled in settings
   */
  _isEnabled() {
    if (!this.store) {
      return DEFAULT_DISCORD_RPC_ENABLED;
    }
    return this.store.get('discordRPCEnabled', DEFAULT_DISCORD_RPC_ENABLED);
  }

  /**
   * Log error with throttling to avoid spam
   */
  _logError(message, error) {
    const errorMessage = error?.message ? String(error.message) : String(error);
    
    if (errorMessage && errorMessage.toLowerCase().includes('could not connect')) {
      return;
    }

    const now = Date.now();
    if (now - this.lastErrorLog < this.errorLogThrottle) {
      return;
    }

    this.lastErrorLog = now;
    this.logger.warn(`Discord RPC: ${message}`, { error: errorMessage });
  }

  /**
   * Validate media metadata before sending
   */
  _validateMetadata(metadata) {
    if (!metadata) {
      return false;
    }

    const hasTitle = metadata.title && typeof metadata.title === 'string';
    const hasProgress = metadata.currentTime != null || metadata.duration != null;
    
    return hasTitle || hasProgress;
  }

  /**
   * Build activity payload from media metadata
   */
  _buildActivity(metadata) {
    if (!metadata) {
      return {
        details: 'P-Stream',
        state: 'Browsing',
        startTimestamp: new Date(),
        largeImageKey: 'logo',
        largeImageText: 'P-Stream',
        instance: false,
        buttons: [{ label: 'Use P-Stream', url: this._getStreamUrl() }],
      };
    }

    const activity = {
      name: this._getActivityName(metadata),
      details: this._getMediaTitle(metadata),
      state: 'Loading...',
      startTimestamp: new Date(),
      largeImageKey: metadata.poster || 'logo',
      largeImageText: metadata.artist || metadata.title || 'P-Stream',
      smallImageKey: 'logo',
      smallImageText: 'P-Stream',
      instance: false,
      buttons: [{ label: 'Use P-Stream', url: this._getStreamUrl() }],
    };

    if (metadata.isPlaying) {
      const [startTimestamp, endTimestamp] = this._getTimestamps(metadata);
      if (startTimestamp != null) {
        activity.startTimestamp = startTimestamp;
      }
      if (endTimestamp != null) {
        activity.endTimestamp = endTimestamp;
      }
      activity.state = 'Watching';
    } else if (metadata.isPlaying === false) {
      activity.startTimestamp = new Date();
      activity.endTimestamp = undefined;
      activity.state = 'Paused';
    }

    return activity;
  }

  /**
   * Get stream URL for activity button
   */
  _getStreamUrl() {
    if (!this.store) {
      return 'https://pstream.net/';
    }
    const streamUrl = this.store.get('streamUrl', 'pstream.net');
    return streamUrl.startsWith('http://') || streamUrl.startsWith('https://') 
      ? streamUrl 
      : `https://${streamUrl}/`;
  }

  /**
   * Get activity name from metadata
   */
  _getActivityName(metadata) {
    if (!metadata?.title) {
      return 'P-Stream';
    }
    return metadata.artist ? metadata.artist : metadata.title;
  }

  /**
   * Get media title from metadata
   */
  _getMediaTitle(metadata) {
    if (!metadata?.title) {
      return 'P-Stream';
    }
    return metadata.artist ? `${metadata.artist} - ${metadata.title}` : metadata.title;
  }

  /**
   * Calculate timestamps for progress bar
   */
  _getTimestamps(metadata) {
    if (!metadata || metadata.currentTime == null) {
      return [undefined, undefined];
    }

    const currentTimeSec = Number(metadata.currentTime);
    const durationSec = Number.isFinite(metadata.duration) ? Number(metadata.duration) : NaN;

    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      return [undefined, undefined];
    }

    const nowMs = Date.now();
    const startMs = Math.round(nowMs - currentTimeSec * 1000);
    const endMs = Math.round(startMs + durationSec * 1000);

    return [startMs, endMs];
  }

  /**
   * Send activity to Discord
   */
  async _setActivityRaw(args) {
    if (!this.client || typeof this.client.request !== 'function') {
      return;
    }

    if (this.state !== ConnectionState.READY) {
      this.connect();
      return;
    }

    let timestamps;
    if (args.startTimestamp != null || args.endTimestamp != null) {
      const start = args.startTimestamp != null
        ? Math.round(args.startTimestamp instanceof Date ? args.startTimestamp.getTime() : args.startTimestamp)
        : NaN;
      const end = args.endTimestamp != null
        ? Math.round(args.endTimestamp instanceof Date ? args.endTimestamp.getTime() : args.endTimestamp)
        : NaN;
      
      timestamps = {};
      if (Number.isFinite(start)) timestamps.start = start;
      if (Number.isFinite(end)) timestamps.end = end;
      if (Object.keys(timestamps).length === 0) timestamps = undefined;
    }

    const assets = args.largeImageKey || args.largeImageText ? {
      large_image: args.largeImageKey,
      large_text: args.largeImageText,
      small_image: args.smallImageKey,
      small_text: args.smallImageText,
    } : undefined;

    const activity = {
      type: DISCORD_ACTIVITY_TYPE_WATCHING,
      name: args.name ?? 'P-Stream',
      state: args.state ?? undefined,
      details: args.details ?? undefined,
      timestamps,
      assets,
      buttons: args.buttons,
      instance: !!args.instance,
    };

    try {
      await this.client.request('SET_ACTIVITY', { pid: process.pid, activity });
    } catch (error) {
      this.state = ConnectionState.DISCONNECTED;
      this._logError('Failed to set activity', error);
    }
  }

  /**
   * Update Discord activity with media metadata
   */
  async updateActivity(metadata) {
    if (!this._isEnabled()) {
      await this.clearActivity();
      return;
    }

    if (metadata && !this._validateMetadata(metadata)) {
      this.logger.debug('Invalid metadata, skipping update');
      return;
    }

    this.currentMediaMetadata = metadata;
    const activity = this._buildActivity(metadata);
    await this._setActivityRaw(activity);
  }

  /**
   * Clear Discord activity
   */
  async clearActivity() {
    if (!this.client || typeof this.client.clearActivity !== 'function') {
      return;
    }

    if (this.state !== ConnectionState.READY) {
      return;
    }

    try {
      await this.client.clearActivity();
      this.currentMediaMetadata = null;
    } catch (error) {
      this.state = ConnectionState.DISCONNECTED;
      this._logError('Failed to clear activity', error);
    }
  }

  /**
   * Handle media metadata update from IPC
   */
  async handleMediaMetadataUpdate(data) {
    try {
      const hasMetadata = data?.metadata && (data.metadata.title || data.metadata.artist);
      const hasProgress = data?.progress && (data.progress.currentTime != null || data.progress.duration != null);

      if (!hasMetadata || !hasProgress) {
        this.currentMediaMetadata = null;
        await this.updateActivity(null);
        return { success: true };
      }

      if (!this.currentMediaMetadata) {
        this.currentMediaMetadata = {};
      }

      if (data.metadata) {
        Object.assign(this.currentMediaMetadata, {
          title: data.metadata.title ?? this.currentMediaMetadata.title,
          artist: data.metadata.artist ?? this.currentMediaMetadata.artist,
          poster: data.metadata.poster ?? this.currentMediaMetadata.poster,
          season: data.metadata.season != null && !isNaN(data.metadata.season) 
            ? data.metadata.season 
            : this.currentMediaMetadata.season,
          episode: data.metadata.episode != null && !isNaN(data.metadata.episode) 
            ? data.metadata.episode 
            : this.currentMediaMetadata.episode,
        });
      }

      if (data.progress) {
        Object.assign(this.currentMediaMetadata, {
          currentTime: data.progress.currentTime != null && !isNaN(data.progress.currentTime) 
            ? data.progress.currentTime 
            : this.currentMediaMetadata.currentTime,
          duration: data.progress.duration != null && !isNaN(data.progress.duration) 
            ? data.progress.duration 
            : this.currentMediaMetadata.duration,
          isPlaying: data.progress.isPlaying ?? this.currentMediaMetadata.isPlaying,
        });
      }

      await this.updateActivity(this.currentMediaMetadata);
      return { success: true };
    } catch (error) {
      this.logger.error('Error updating media metadata', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Enable or disable Discord RPC
   */
  async setEnabled(enabled) {
    if (!this.store) {
      return false;
    }

    this.store.set('discordRPCEnabled', enabled);

    if (enabled) {
      await this.updateActivity(this.currentMediaMetadata);
    } else {
      await this.clearActivity();
    }

    return true;
  }

  /**
   * Get current connection state
   */
  getState() {
    return this.state;
  }

  /**
   * Disconnect from Discord
   */
  async disconnect() {
    if (this.client) {
      try {
        await this.clearActivity();
        this.client.destroy();
      } catch (error) {
        this.logger.error('Error during disconnect', error);
      }
    }
    
    this.state = ConnectionState.DISCONNECTED;
    this.client = null;
  }
}

module.exports = DiscordRPCService;
