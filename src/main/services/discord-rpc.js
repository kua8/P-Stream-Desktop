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
      // Only initialize if enabled
      if (!this._isEnabled()) {
        this.logger.info('Discord RPC is disabled, skipping initialization');
        return;
      }

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
   * Validate media metadata before sending — just needs a title or artist
   */
  _validateMetadata(metadata) {
    if (!metadata) return false;
    return !!(metadata.title || metadata.artist);
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

    let largeImageKey = 'logo';
    if (metadata.poster && typeof metadata.poster === 'string') {
      if (metadata.poster.startsWith('https://') || metadata.poster.startsWith('http://')) {
        largeImageKey = metadata.poster;
      }
    }

    const activityName = metadata.artist || metadata.title || 'P-Stream';

    const activity = {
      name: activityName,
      details: this._getMediaTitle(metadata),
      state: 'Loading...',
      startTimestamp: new Date(),
      largeImageKey,
      largeImageText: metadata.artist || metadata.title || 'P-Stream',
      smallImageKey: 'logo_no_bg',
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
      const currentTimeSec = Number(metadata.currentTime);
      if (Number.isFinite(currentTimeSec)) {
        const nowMs = Date.now();
        activity.startTimestamp = Math.round(nowMs - currentTimeSec * 1000);
      }
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
   * Get media title from metadata (shown as Discord "details")
   * Format: "Show | S3 E5" or just "Movie Title"
   */
  _getMediaTitle(metadata) {
    if (!metadata?.title) {
      return 'P-Stream';
    }

    const hasSeason = metadata.season != null && !isNaN(metadata.season);
    const hasEpisode = metadata.episode != null && !isNaN(metadata.episode);

    if (metadata.artist) {
      // TV show: "Show | S3 E5" 
      if (hasSeason && hasEpisode) {
        return `${metadata.artist} | S${metadata.season} E${metadata.episode}`;
      }
      return metadata.artist;
    }

    return metadata.title;
  }

  /**
   * Get formatted title for window titlebar
   * e.g. "Breaking Bad · S3 E5 · Paused" or "Inception · Watching"
   */
  _getTitlebarText(metadata) {
    if (!metadata?.title) {
      return 'PSTREAM';
    }

    const parts = [];

    // Show name (artist) or movie title
    if (metadata.artist) {
      parts.push(metadata.artist);
    } else {
      parts.push(metadata.title);
    }

    // Season / episode
    const hasSeason = metadata.season != null && !isNaN(metadata.season);
    const hasEpisode = metadata.episode != null && !isNaN(metadata.episode);
    if (hasSeason && hasEpisode) {
      parts.push(`S${metadata.season} E${metadata.episode}`);
    } else if (metadata.artist && metadata.title) {
      // episode title when no S/E numbers
      parts.push(metadata.title);
    }

    // Playback state
    if (metadata.isPlaying === true) {
      parts.push('Watching');
    } else if (metadata.isPlaying === false) {
      parts.push('Paused');
    }

    return parts.join(' · ');
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
      return;
    }

    this.currentMediaMetadata = metadata;
    const activity = this._buildActivity(metadata);
    await this._setActivityRaw(activity);
    
    this._updateTitlebar(metadata);
  }

  /**
   * Set the titlebar webContents reference so we can send IPC events to it
   * @param {Electron.WebContents} webContents
   */
  setTitlebarWebContents(webContents) {
    this._titlebarWebContents = webContents;
  }

  /**
   * Update the main window titlebar with current media info
   */
  _updateTitlebar(metadata) {
    try {
      const wc = this._titlebarWebContents;
      if (wc && !wc.isDestroyed()) {
        const text = this._getTitlebarText(metadata);
        wc.send('update-title', text);
      }
    } catch (error) {
      this.logger.debug('Failed to update titlebar', { error: error.message });
    }
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
      this._updateTitlebar(null); // Reset titlebar to default
    } catch (error) {
      this.state = ConnectionState.DISCONNECTED;
      this._logError('Failed to clear activity', error);
    }
  }

  async handleMediaMetadataUpdate(data) {
    try {
      if (data === null || data === undefined) {
        this.currentMediaMetadata = null;
        await this.updateActivity(null);
        return { success: true };
      }

      const meta = data.metadata ?? data;
      const prog = data.progress ?? data;

      const hasTitle = meta.title || meta.artist;
      const hasProgress = prog.currentTime != null || prog.duration != null;

      if (!hasTitle && !hasProgress) {
        this.currentMediaMetadata = null;
        await this.updateActivity(null);
        return { success: true };
      }

      if (!this.currentMediaMetadata) {
        this.currentMediaMetadata = {};
      }

      if (meta.title != null)  this.currentMediaMetadata.title  = meta.title;
      if (meta.artist != null) this.currentMediaMetadata.artist = meta.artist;
      if (meta.poster != null) this.currentMediaMetadata.poster = meta.poster;
      if (meta.season  != null && !isNaN(meta.season))  this.currentMediaMetadata.season  = meta.season;
      if (meta.episode != null && !isNaN(meta.episode)) this.currentMediaMetadata.episode = meta.episode;

      if (prog.currentTime != null && !isNaN(prog.currentTime)) this.currentMediaMetadata.currentTime = prog.currentTime;
      if (prog.duration    != null && !isNaN(prog.duration))    this.currentMediaMetadata.duration    = prog.duration;
      if (prog.isPlaying   != null) this.currentMediaMetadata.isPlaying = prog.isPlaying;

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
      // Initialize if not already done
      if (!this.client) {
        try {
          DiscordRPC.register(DISCORD_CLIENT_ID);
          this.client = new DiscordRPC.Client({ transport: 'ipc' });
          this.client.on('ready', () => this._handleReady());
          this.client.on('disconnected', () => this._handleDisconnected());
          await this.connect();
        } catch (error) {
          this.logger.error('Failed to initialize Discord RPC', error);
          return false;
        }
      }
      await this.updateActivity(this.currentMediaMetadata);
    } else {
      await this.clearActivity();
      await this.disconnect();
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
