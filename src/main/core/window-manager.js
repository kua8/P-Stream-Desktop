const { BrowserWindow, BrowserView, shell } = require('electron');
const path = require('path');
const {
  DEFAULT_MAIN_WINDOW_WIDTH,
  DEFAULT_MAIN_WINDOW_HEIGHT,
  DEFAULT_MAIN_WINDOW_MIN_WIDTH,
  DEFAULT_MAIN_WINDOW_MIN_HEIGHT,
  DEFAULT_SETTINGS_WINDOW_WIDTH,
  DEFAULT_SETTINGS_WINDOW_HEIGHT,
  DEFAULT_SETUP_WINDOW_WIDTH,
  DEFAULT_SETUP_WINDOW_HEIGHT,
  DEFAULT_TITLEBAR_HEIGHT,
  APP_ICON_FILE,
} = require('../../shared/constants');

/**
 * Manages window creation and lifecycle
 */
class WindowManager {
  constructor(dependencies) {
    this.store = dependencies.store;
    this.logger = dependencies.logger;
    this.appIcon = dependencies.appIcon;
    
    this.mainWindow = null;
    this.settingsWindow = null;
    this.siteContents = null;
    this.titlebarContents = null;
    this.fullscreenInterval = null;
  }

  /**
   * Create the main application window with titlebar and site BrowserView
   * @param {string} url - URL to load in the site BrowserView
   * @returns {BrowserWindow} The created main window
   */
  createMainWindow(url) {
    this.logger.info('Creating main window', { url });

    this.mainWindow = new BrowserWindow({
      width: DEFAULT_MAIN_WINDOW_WIDTH,
      height: DEFAULT_MAIN_WINDOW_HEIGHT,
      minWidth: DEFAULT_MAIN_WINDOW_MIN_WIDTH,
      minHeight: DEFAULT_MAIN_WINDOW_MIN_HEIGHT,
      frame: false,
      title: 'P-Stream',
      webPreferences: { contextIsolation: true },
      backgroundColor: '#0d0d0d',
      ...(this.appIcon ? { icon: this.appIcon } : {}),
    });

    this.mainWindow.setMenuBarVisibility(false);

    const titlebar = new BrowserView({
      webPreferences: {
        preload: path.join(__dirname, '../../preload/preload.js'),
        contextIsolation: true,
      },
    });
    this.mainWindow.addBrowserView(titlebar);
    titlebar.setBounds({
      x: 0,
      y: 0,
      width: DEFAULT_MAIN_WINDOW_WIDTH,
      height: DEFAULT_TITLEBAR_HEIGHT,
    });
    titlebar.setAutoResize({ width: true });
    titlebar.webContents.loadFile(path.join(__dirname, '../../renderer/titlebar/titlebar.html'));

    const site = new BrowserView({
      webPreferences: {
        preload: path.join(__dirname, '../../preload/preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    this.mainWindow.addBrowserView(site);
    site.setBounds({
      x: 0,
      y: DEFAULT_TITLEBAR_HEIGHT,
      width: DEFAULT_MAIN_WINDOW_WIDTH,
      height: DEFAULT_MAIN_WINDOW_HEIGHT - DEFAULT_TITLEBAR_HEIGHT,
    });
    site.setAutoResize({ width: true, height: true });
    site.webContents.loadURL(url);
    site.webContents.setWindowOpenHandler(({ url: u }) => {
      shell.openExternal(u);
      return { action: 'deny' };
    });

    this.siteContents = site.webContents;
    this.titlebarContents = titlebar.webContents;

    // Inject media metadata monitor after page loads
    site.webContents.on('did-finish-load', () => {
      setTimeout(() => {
        site.webContents.executeJavaScript(`
          (function() {
            console.log('[P-Stream] Injecting media metadata monitor...');
            
            let lastMetadata = null;
            let lastProgress = null;
            let lastVideoSrc = null;
            
            function extractMetadata() {
              // Find video element
              const video = document.querySelector('video');
              
              // If no video or video ended, return null to clear activity
              if (!video || !video.src || video.ended) return null;
              
              // If video source changed, we're on a new video
              if (video.src !== lastVideoSrc) {
                lastVideoSrc = video.src;
                lastMetadata = null;
                lastProgress = null;
              }
              
              // Try to get metadata from MediaSession API first
              let title = null;
              let artist = null;
              let poster = null;
              
              if ('mediaSession' in navigator && navigator.mediaSession.metadata) {
                const meta = navigator.mediaSession.metadata;
                title = meta.title;
                artist = meta.artist;
                if (meta.artwork && meta.artwork.length > 0) {
                  poster = meta.artwork[0].src;
                }
              }
              
              // Fallback: extract from page DOM
              if (!title) {
                const titleEl = document.querySelector('h1, [class*="title"], [class*="heading"]');
                title = titleEl?.textContent?.trim() || document.title.replace(' - P-Stream', '').trim();
              }
              
              // Try to find poster from og:image or page images
              if (!poster) {
                const ogImage = document.querySelector('meta[property="og:image"]');
                if (ogImage) {
                  poster = ogImage.content;
                  if (poster && !poster.startsWith('http')) {
                    poster = new URL(poster, window.location.origin).href;
                  }
                }
              }
              
              // Parse season/episode from title
              let season = null;
              let episode = null;
              const match = title.match(/S(\\d+)\\s*E(\\d+)/i);
              if (match) {
                season = parseInt(match[1]);
                episode = parseInt(match[2]);
                // Extract show name (everything before S#E#)
                const showMatch = title.match(/^(.+?)\\s*[-:]?\\s*S\\d+/i);
                if (showMatch) {
                  artist = showMatch[1].trim();
                  // Remove the S#E# part from title to get episode name
                  title = title.replace(/^.+?S\\d+\\s*E\\d+\\s*[-:]?\\s*/i, '').trim() || title;
                }
              }
              
              return {
                metadata: {
                  title: title,
                  artist: artist,
                  poster: poster,
                  season: season,
                  episode: episode
                },
                progress: {
                  currentTime: video.currentTime,
                  duration: video.duration,
                  isPlaying: !video.paused && !video.ended && video.readyState >= 2
                }
              };
            }
            
            function sendUpdate() {
              const data = extractMetadata();
              if (!data) {
                // No video found, clear activity
                if (lastMetadata !== null) {
                  lastMetadata = null;
                  lastProgress = null;
                  if (typeof window.updateMediaMetadata === 'function') {
                    window.updateMediaMetadata(null).catch(e => 
                      console.error('[P-Stream] updateMediaMetadata error:', e)
                    );
                  }
                }
                return;
              }
              
              // Only send if something meaningful changed
              const metaStr = JSON.stringify(data.metadata);
              const progStr = JSON.stringify({
                currentTime: Math.floor(data.progress.currentTime),
                duration: Math.floor(data.progress.duration),
                isPlaying: data.progress.isPlaying
              });
              
              if (metaStr !== lastMetadata || progStr !== lastProgress) {
                lastMetadata = metaStr;
                lastProgress = progStr;
                
                console.log('[P-Stream] Sending metadata update:', data);
                
                if (typeof window.updateMediaMetadata === 'function') {
                  window.updateMediaMetadata(data).catch(e => 
                    console.error('[P-Stream] updateMediaMetadata error:', e)
                  );
                }
              }
            }
            
            // Monitor video element
            setInterval(sendUpdate, 2000);
            
            // Also send on play/pause/ended events
            document.addEventListener('play', sendUpdate, true);
            document.addEventListener('pause', sendUpdate, true);
            document.addEventListener('ended', sendUpdate, true);
            document.addEventListener('timeupdate', sendUpdate, true);
            
            console.log('[P-Stream] Media metadata monitor active');
          })();
        `).catch(err => this.logger.error('Failed to inject metadata monitor', err));
      }, 3000);
    });

    this.siteContents = site.webContents;
    this.titlebarContents = titlebar.webContents;

    this.mainWindow.on('resize', () => {
      const [w, h] = this.mainWindow.getContentSize();
      titlebar.setBounds({ x: 0, y: 0, width: w, height: DEFAULT_TITLEBAR_HEIGHT });
      site.setBounds({
        x: 0,
        y: DEFAULT_TITLEBAR_HEIGHT,
        width: w,
        height: h - DEFAULT_TITLEBAR_HEIGHT,
      });
    });

    this.setupFullscreenHandling(titlebar, site);

    return this.mainWindow;
  }

  /**
   * Create the settings window
   * @returns {BrowserWindow} The created settings window
   */
  createSettingsWindow() {
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      this.settingsWindow.focus();
      return this.settingsWindow;
    }

    this.logger.info('Creating settings window');

    this.settingsWindow = new BrowserWindow({
      width: DEFAULT_SETTINGS_WINDOW_WIDTH,
      height: DEFAULT_SETTINGS_WINDOW_HEIGHT,
      resizable: false,
      frame: false,
      title: 'P-Stream Settings',
      webPreferences: {
        preload: path.join(__dirname, '../../preload/preload.js'),
        contextIsolation: true,
      },
      backgroundColor: '#030303',
      show: false,
      ...(this.appIcon ? { icon: this.appIcon } : {}),
    });

    this.settingsWindow.setMenuBarVisibility(false);
    this.settingsWindow.loadFile(path.join(__dirname, '../../renderer/settings/settings.html'));
    this.settingsWindow.once('ready-to-show', () => this.settingsWindow.show());
    this.settingsWindow.on('closed', () => {
      this.settingsWindow = null;
    });

    return this.settingsWindow;
  }

  /**
   * Create the setup window
   * @returns {BrowserWindow} The created setup window
   */
  createSetupWindow() {
    this.logger.info('Creating setup window');

    const setupWindow = new BrowserWindow({
      width: DEFAULT_SETUP_WINDOW_WIDTH,
      height: DEFAULT_SETUP_WINDOW_HEIGHT,
      resizable: false,
      frame: false,
      title: 'P-Stream Setup',
      webPreferences: {
        preload: path.join(__dirname, '../../preload/preload.js'),
        contextIsolation: true,
      },
      backgroundColor: '#0d0d0d',
      ...(this.appIcon ? { icon: this.appIcon } : {}),
    });

    setupWindow.setMenuBarVisibility(false);
    setupWindow.loadFile(path.join(__dirname, '../../renderer/setup/setup.html'));

    return setupWindow;
  }

  /**
   * Setup fullscreen handling for the main window
   * @param {BrowserView} titlebar - The titlebar BrowserView
   * @param {BrowserView} site - The site BrowserView
   */
  setupFullscreenHandling(titlebar, site) {
    this.fullscreenInterval = setInterval(() => {
      if (!this.mainWindow || this.mainWindow.isDestroyed()) {
        clearInterval(this.fullscreenInterval);
        return;
      }

      const isFullscreen = this.mainWindow.isFullScreen();
      const [w, h] = this.mainWindow.getContentSize();

      if (isFullscreen) {
        titlebar.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        site.setBounds({ x: 0, y: 0, width: w, height: h });
      } else {
        titlebar.setBounds({ x: 0, y: 0, width: w, height: DEFAULT_TITLEBAR_HEIGHT });
        site.setBounds({
          x: 0,
          y: DEFAULT_TITLEBAR_HEIGHT,
          width: w,
          height: h - DEFAULT_TITLEBAR_HEIGHT,
        });
      }
    }, 100);
  }

  /**
   * Get the main window instance
   * @returns {BrowserWindow|null}
   */
  getMainWindow() {
    return this.mainWindow;
  }

  /**
   * Get the settings window instance
   * @returns {BrowserWindow|null}
   */
  getSettingsWindow() {
    return this.settingsWindow;
  }

  /**
   * Get the site BrowserView's webContents
   * @returns {WebContents|null}
   */
  getSiteContents() {
    return this.siteContents;
  }

  /**
   * Get the titlebar BrowserView's webContents
   * @returns {WebContents|null}
   */
  getTitlebarContents() {
    return this.titlebarContents;
  }

  /**
   * Clean up resources
   */
  cleanup() {
    if (this.fullscreenInterval) {
      clearInterval(this.fullscreenInterval);
      this.fullscreenInterval = null;
    }
  }
}

module.exports = WindowManager;
