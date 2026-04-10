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
