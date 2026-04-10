/**
 * Application-wide constants
 * Shared between main, preload, and renderer processes
 */

// ── IPC CHANNEL NAMES ──

/**
 * Window control channels (one-way)
 */
const IPC_WINDOW_MINIMIZE = 'minimize-window';
const IPC_WINDOW_MAXIMIZE = 'maximize-window';
const IPC_WINDOW_CLOSE = 'close-window';

/**
 * Navigation and URL channels
 */
const IPC_OPEN_SETTINGS = 'open-settings';
const IPC_CLOSE_SETTINGS = 'close-settings';
const IPC_SET_URL = 'set-url';
const IPC_RESET_URL = 'reset-url';
const IPC_SAVE_DOMAIN = 'save-domain';
const IPC_GET_STREAM_URL = 'get-stream-url';
const IPC_SET_STREAM_URL = 'set-stream-url';

/**
 * Application lifecycle channels
 */
const IPC_GET_VERSION = 'get-version';
const IPC_RESET_APP = 'reset-app';
const IPC_RESTART_APP = 'restart-app';
const IPC_UNINSTALL_APP = 'uninstall-app';

/**
 * Update channels
 */
const IPC_CHECK_FOR_UPDATES = 'check-for-updates';
const IPC_INSTALL_UPDATE = 'install-update';
const IPC_OPEN_RELEASES_PAGE = 'open-releases-page';
const IPC_UPDATE_PROGRESS = 'update-progress';

/**
 * Discord RPC channels
 */
const IPC_GET_DISCORD_RPC = 'get-discord-rpc';
const IPC_SET_DISCORD_RPC = 'set-discord-rpc';
const IPC_UPDATE_MEDIA_METADATA = 'updateMediaMetadata';

/**
 * WARP proxy channels
 */
const IPC_SET_WARP = 'set-warp';
const IPC_GET_WARP_STATUS = 'get-warp-status';
const IPC_SET_WARP_LAUNCH = 'set-warp-launch';
const IPC_GET_WARP_LAUNCH = 'get-warp-launch';

/**
 * Settings channels
 */
const IPC_SET_HW_ACCEL = 'set-hw-accel';
const IPC_GET_HW_ACCEL = 'get-hw-accel';
const IPC_SET_VOLUME_BOOST = 'set-volume-boost';
const IPC_GET_VOLUME_BOOST = 'get-volume-boost';

/**
 * Download and offline channels
 */
const IPC_START_DOWNLOAD = 'start-download';
const IPC_OPEN_OFFLINE = 'open-offline';

// ── DEFAULT VALUES ──

/**
 * Default application settings
 */
const DEFAULT_STREAM_URL = 'pstream.net';
const DEFAULT_DISCORD_RPC_ENABLED = true;
const DEFAULT_WARP_ENABLED = false;
const DEFAULT_WARP_LAUNCH_ENABLED = false;
const DEFAULT_HW_ACCEL_ENABLED = true;
const DEFAULT_VOLUME_BOOST = 1.0;
const DEFAULT_THEME_COLOR = '#0d0d0d';

/**
 * Default window dimensions
 */
const DEFAULT_MAIN_WINDOW_WIDTH = 1280;
const DEFAULT_MAIN_WINDOW_HEIGHT = 800;
const DEFAULT_MAIN_WINDOW_MIN_WIDTH = 900;
const DEFAULT_MAIN_WINDOW_MIN_HEIGHT = 600;

const DEFAULT_SETTINGS_WINDOW_WIDTH = 720;
const DEFAULT_SETTINGS_WINDOW_HEIGHT = 520;

const DEFAULT_SETUP_WINDOW_WIDTH = 500;
const DEFAULT_SETUP_WINDOW_HEIGHT = 400;

const DEFAULT_TITLEBAR_HEIGHT = 32;

// ── CONFIGURATION ──

/**
 * Discord RPC configuration
 */
const DISCORD_CLIENT_ID = '1451640447993774232';
const DISCORD_ACTIVITY_TYPE_WATCHING = 3;
const DISCORD_LOGIN_RETRY_MS = 10000;
const DISCORD_ERROR_LOG_THROTTLE_MS = 60000;

/**
 * WARP CLI paths by platform
 */
const WARP_CLI_PATHS = {
  win32: 'C:\\Program Files\\Cloudflare\\Cloudflare WARP\\warp-cli.exe',
  darwin: '/usr/local/bin/warp-cli',
  linux: '/usr/local/bin/warp-cli',
};

const WARP_CLI_TIMEOUT = 10000;

/**
 * Application identifiers
 */
const DEFAULT_APP_ID = 'com.pstream.desktop';

/**
 * File names
 */
const CONFIG_FILE_NAME = 'config.json';
const APP_ICON_FILE = 'logo.ico';

/**
 * Volume boost constraints
 */
const VOLUME_BOOST_MIN = 1.0;
const VOLUME_BOOST_MAX = 10.0;

/**
 * Extension flags exposed to web content
 */
const EXTENSION_FLAGS = {
  PSTREAM_DESKTOP: '__PSTREAM_DESKTOP__',
  MW_DESKTOP: '__MW_DESKTOP__',
  SUDO_DESKTOP: '__SUDO_DESKTOP__',
  EXTENSION_ACTIVE: '__EXTENSION_ACTIVE__',
  PSTREAM_EXTENSION: '__PSTREAM_EXTENSION__',
  PSTREAM_EXTENSION_CACHED: '__PSTREAM_EXTENSION_CACHED__',
};

/**
 * Extension version reported to web content
 */
const EXTENSION_VERSION = '2.0.0';

/**
 * Timing constants
 */
const VOLUME_BOOST_APPLY_DELAY = 200;
const EXTENSION_RESPONSE_DELAY = 50;

// ── EXPORTS ──

module.exports = {
  // IPC Channels
  IPC_WINDOW_MINIMIZE,
  IPC_WINDOW_MAXIMIZE,
  IPC_WINDOW_CLOSE,
  IPC_OPEN_SETTINGS,
  IPC_CLOSE_SETTINGS,
  IPC_SET_URL,
  IPC_RESET_URL,
  IPC_SAVE_DOMAIN,
  IPC_GET_STREAM_URL,
  IPC_SET_STREAM_URL,
  IPC_GET_VERSION,
  IPC_RESET_APP,
  IPC_RESTART_APP,
  IPC_UNINSTALL_APP,
  IPC_CHECK_FOR_UPDATES,
  IPC_INSTALL_UPDATE,
  IPC_OPEN_RELEASES_PAGE,
  IPC_UPDATE_PROGRESS,
  IPC_GET_DISCORD_RPC,
  IPC_SET_DISCORD_RPC,
  IPC_UPDATE_MEDIA_METADATA,
  IPC_SET_WARP,
  IPC_GET_WARP_STATUS,
  IPC_SET_WARP_LAUNCH,
  IPC_GET_WARP_LAUNCH,
  IPC_SET_HW_ACCEL,
  IPC_GET_HW_ACCEL,
  IPC_SET_VOLUME_BOOST,
  IPC_GET_VOLUME_BOOST,
  IPC_START_DOWNLOAD,
  IPC_OPEN_OFFLINE,

  // Default Values
  DEFAULT_STREAM_URL,
  DEFAULT_DISCORD_RPC_ENABLED,
  DEFAULT_WARP_ENABLED,
  DEFAULT_WARP_LAUNCH_ENABLED,
  DEFAULT_HW_ACCEL_ENABLED,
  DEFAULT_VOLUME_BOOST,
  DEFAULT_THEME_COLOR,

  // Window Dimensions
  DEFAULT_MAIN_WINDOW_WIDTH,
  DEFAULT_MAIN_WINDOW_HEIGHT,
  DEFAULT_MAIN_WINDOW_MIN_WIDTH,
  DEFAULT_MAIN_WINDOW_MIN_HEIGHT,
  DEFAULT_SETTINGS_WINDOW_WIDTH,
  DEFAULT_SETTINGS_WINDOW_HEIGHT,
  DEFAULT_SETUP_WINDOW_WIDTH,
  DEFAULT_SETUP_WINDOW_HEIGHT,
  DEFAULT_TITLEBAR_HEIGHT,

  // Discord Configuration
  DISCORD_CLIENT_ID,
  DISCORD_ACTIVITY_TYPE_WATCHING,
  DISCORD_LOGIN_RETRY_MS,
  DISCORD_ERROR_LOG_THROTTLE_MS,

  // WARP Configuration
  WARP_CLI_PATHS,
  WARP_CLI_TIMEOUT,

  // Application Configuration
  DEFAULT_APP_ID,
  CONFIG_FILE_NAME,
  APP_ICON_FILE,

  // Volume Boost
  VOLUME_BOOST_MIN,
  VOLUME_BOOST_MAX,

  // Extension Flags
  EXTENSION_FLAGS,
  EXTENSION_VERSION,

  // Timing
  VOLUME_BOOST_APPLY_DELAY,
  EXTENSION_RESPONSE_DELAY,
};
