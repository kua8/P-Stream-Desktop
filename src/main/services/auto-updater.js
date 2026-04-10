const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { NetworkError } = require('../utils/errors');

const GITHUB_OWNER = 'p-stream';
const GITHUB_REPO = 'p-stream-desktop';
const DEFAULT_TIMEOUT = 10000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 2000;

/**
 * Manages application updates with retry logic and integrity verification
 */
class AutoUpdaterService {
  constructor(dependencies) {
    this.logger = dependencies.logger;
    this.currentVersion = dependencies.currentVersion;
    this.timeout = dependencies.timeout || DEFAULT_TIMEOUT;
    this.maxRetries = dependencies.maxRetries || DEFAULT_MAX_RETRIES;
    this.retryDelay = dependencies.retryDelay || DEFAULT_RETRY_DELAY;
    this.updaterWindow = null;
  }

  /**
   * Compare two semantic versions
   * @param {string} current - Current version
   * @param {string} latest - Latest version
   * @returns {number} 1 if latest > current, -1 if latest < current, 0 if equal
   */
  compareVersions(current, latest) {
    const parseVersion = (version) => {
      const cleaned = version.replace(/^v/, '');
      const parts = cleaned.split('-');
      const versionParts = parts[0].split('.').map(Number);
      const preRelease = parts[1] || null;
      return { versionParts, preRelease };
    };

    const currentParsed = parseVersion(current);
    const latestParsed = parseVersion(latest);

    for (let i = 0; i < Math.max(currentParsed.versionParts.length, latestParsed.versionParts.length); i++) {
      const currentPart = currentParsed.versionParts[i] || 0;
      const latestPart = latestParsed.versionParts[i] || 0;

      if (latestPart > currentPart) return 1;
      if (latestPart < currentPart) return -1;
    }

    if (!currentParsed.preRelease && latestParsed.preRelease) return -1;
    if (currentParsed.preRelease && !latestParsed.preRelease) return 1;
    if (currentParsed.preRelease && latestParsed.preRelease) {
      return currentParsed.preRelease.localeCompare(latestParsed.preRelease);
    }

    return 0;
  }

  /**
   * Fetch JSON from a URL with timeout and retry
   * @param {string} url - URL to fetch
   * @param {number} attempt - Current attempt number
   * @returns {Promise<Object>} Parsed JSON response
   */
  async fetchJSON(url, attempt = 1) {
    return new Promise((resolve, reject) => {
      const options = {
        headers: {
          'User-Agent': 'P-Stream-Desktop-Updater',
          Accept: 'application/vnd.github.v3+json',
        },
      };

      const urlObj = new URL(url);
      const reqOptions = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        timeout: this.timeout,
        ...options,
      };

      const req = https.get(reqOptions, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          this.fetchJSON(res.headers.location, attempt).then(resolve).catch(reject);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new NetworkError(`HTTP ${res.statusCode}`, { url, statusCode: res.statusCode }));
          return;
        }

        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new NetworkError('Invalid JSON response', { url, error: e.message }));
          }
        });
      });

      req.on('error', (error) => {
        if (attempt < this.maxRetries) {
          this.logger.warn(`Fetch failed, retrying (${attempt}/${this.maxRetries})`, { url, error: error.message });
          setTimeout(() => {
            this.fetchJSON(url, attempt + 1).then(resolve).catch(reject);
          }, this.retryDelay * attempt);
        } else {
          reject(new NetworkError('Request failed', { url, error: error.message, attempts: attempt }));
        }
      });

      req.on('timeout', () => {
        req.destroy();
        if (attempt < this.maxRetries) {
          this.logger.warn(`Request timed out, retrying (${attempt}/${this.maxRetries})`, { url });
          setTimeout(() => {
            this.fetchJSON(url, attempt + 1).then(resolve).catch(reject);
          }, this.retryDelay * attempt);
        } else {
          reject(new NetworkError('Request timed out', { url, timeout: this.timeout, attempts: attempt }));
        }
      });
    });
  }

  /**
   * Download a file with progress reporting and retry logic
   * @param {string} url - URL to download
   * @param {string} destPath - Destination file path
   * @param {Function} onProgress - Progress callback (percent)
   * @param {number} attempt - Current attempt number
   * @returns {Promise<string>} Path to downloaded file
   */
  async downloadFile(url, destPath, onProgress, attempt = 1) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(destPath);

      const doRequest = (requestUrl) => {
        const urlObj = new URL(requestUrl);
        const reqOptions = {
          hostname: urlObj.hostname,
          path: urlObj.pathname + urlObj.search,
          headers: { 'User-Agent': 'P-Stream-Desktop-Updater' },
          timeout: this.timeout,
        };

        const req = https.get(reqOptions, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            doRequest(res.headers.location);
            return;
          }

          if (res.statusCode !== 200) {
            file.close();
            fs.unlink(destPath, () => {});
            
            if (attempt < this.maxRetries) {
              this.logger.warn(`Download failed, retrying (${attempt}/${this.maxRetries})`, { url, statusCode: res.statusCode });
              setTimeout(() => {
                this.downloadFile(url, destPath, onProgress, attempt + 1).then(resolve).catch(reject);
              }, this.retryDelay * attempt);
            } else {
              reject(new NetworkError(`Download failed: HTTP ${res.statusCode}`, { url, statusCode: res.statusCode, attempts: attempt }));
            }
            return;
          }

          const totalSize = parseInt(res.headers['content-length'], 10) || 0;
          let downloadedSize = 0;

          res.on('data', (chunk) => {
            downloadedSize += chunk.length;
            if (totalSize > 0 && onProgress) {
              onProgress(Math.round((downloadedSize / totalSize) * 100));
            }
          });

          res.pipe(file);

          file.on('finish', () => {
            file.close();
            resolve(destPath);
          });

          file.on('error', (err) => {
            file.close();
            fs.unlink(destPath, () => {});
            
            if (attempt < this.maxRetries) {
              this.logger.warn(`Download error, retrying (${attempt}/${this.maxRetries})`, { url, error: err.message });
              setTimeout(() => {
                this.downloadFile(url, destPath, onProgress, attempt + 1).then(resolve).catch(reject);
              }, this.retryDelay * attempt);
            } else {
              reject(new NetworkError('Download failed', { url, error: err.message, attempts: attempt }));
            }
          });
        });

        req.on('error', (err) => {
          file.close();
          fs.unlink(destPath, () => {});
          
          if (attempt < this.maxRetries) {
            this.logger.warn(`Download request error, retrying (${attempt}/${this.maxRetries})`, { url, error: err.message });
            setTimeout(() => {
              this.downloadFile(url, destPath, onProgress, attempt + 1).then(resolve).catch(reject);
            }, this.retryDelay * attempt);
          } else {
            reject(new NetworkError('Download request failed', { url, error: err.message, attempts: attempt }));
          }
        });

        req.on('timeout', () => {
          req.destroy();
          file.close();
          fs.unlink(destPath, () => {});
          
          if (attempt < this.maxRetries) {
            this.logger.warn(`Download timed out, retrying (${attempt}/${this.maxRetries})`, { url });
            setTimeout(() => {
              this.downloadFile(url, destPath, onProgress, attempt + 1).then(resolve).catch(reject);
            }, this.retryDelay * attempt);
          } else {
            reject(new NetworkError('Download timed out', { url, timeout: this.timeout, attempts: attempt }));
          }
        });
      };

      doRequest(url);
    });
  }

  /**
   * Verify file integrity using SHA-256 checksum
   * @param {string} filePath - Path to file
   * @param {string} expectedHash - Expected SHA-256 hash (optional)
   * @returns {Promise<string>} Computed hash
   */
  async verifyIntegrity(filePath, expectedHash = null) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);

      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => {
        const computed = hash.digest('hex');
        if (expectedHash && computed !== expectedHash) {
          reject(new Error(`Integrity check failed: expected ${expectedHash}, got ${computed}`));
        } else {
          resolve(computed);
        }
      });
      stream.on('error', reject);
    });
  }

  /**
   * Get the appropriate installer asset for the current platform
   * @param {Array} assets - Array of release assets
   * @returns {Object|null} Matching asset or null
   */
  getInstallerAsset(assets) {
    const platform = process.platform;
    const arch = process.arch;

    for (const asset of assets) {
      const name = asset.name.toLowerCase();

      if (platform === 'win32') {
        if (name.endsWith('.exe')) {
          if (arch === 'x64' && name.includes('x64')) return asset;
          if (arch === 'arm64' && name.includes('arm64')) return asset;
          if (!name.includes('x64') && !name.includes('arm64')) return asset;
        }
      } else if (platform === 'linux') {
        if (name.endsWith('.appimage')) {
          if (arch === 'x64' && name.includes('x64')) return asset;
          if (arch === 'arm64' && name.includes('arm64')) return asset;
          if (!name.includes('x64') && !name.includes('arm64')) return asset;
        }
      } else if (platform === 'darwin') {
        if (name.endsWith('.dmg')) {
          if (arch === 'x64' && name.includes('x64')) return asset;
          if (arch === 'arm64' && name.includes('arm64')) return asset;
          if (!name.includes('x64') && !name.includes('arm64')) return asset;
        }
      }
    }

    for (const asset of assets) {
      const name = asset.name.toLowerCase();
      if (platform === 'win32' && name.endsWith('.exe')) return asset;
      if (platform === 'linux' && name.endsWith('.appimage')) return asset;
      if (platform === 'darwin' && name.endsWith('.dmg')) return asset;
    }

    return null;
  }

  /**
   * Create the updater window
   * @returns {BrowserWindow} Updater window instance
   */
  createUpdaterWindow() {
    const ROOT = path.join(__dirname, '..', '..', '..');
    const PRELOAD = path.join(__dirname, '..', '..', 'preload');
    const UPDATER = path.join(__dirname, '..', '..', 'renderer', 'updater');

    // Check for logo in multiple locations
    let iconPath = path.join(ROOT, 'logo.ico');
    if (!fs.existsSync(iconPath)) {
      iconPath = path.join(ROOT, 'logo.png');
    }

    this.updaterWindow = new BrowserWindow({
      width: 400,
      height: 200,
      frame: false,
      resizable: false,
      movable: true,
      center: true,
      alwaysOnTop: true,
      skipTaskbar: false,
      backgroundColor: '#1f2025',
      icon: fs.existsSync(iconPath) ? iconPath : undefined,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(PRELOAD, 'preload-updater.js'),
      },
    });

    this.updaterWindow.loadFile(path.join(UPDATER, 'updater.html'));

    return this.updaterWindow;
  }

  /**
   * Send progress update to the updater window
   * @param {number} percent - Progress percentage
   * @param {string} status - Status message
   */
  sendProgress(percent, status) {
    if (this.updaterWindow && !this.updaterWindow.isDestroyed()) {
      this.updaterWindow.webContents.send('update-progress', { percent, status });
    }
  }

  /**
   * Run the installer based on platform
   * @param {string} installerPath - Path to installer file
   * @returns {Promise<void>}
   */
  async installUpdate(installerPath) {
    const platform = process.platform;

    try {
      if (platform === 'win32') {
        const installer = spawn(installerPath, ['/S'], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        });
        installer.unref();
      } else if (platform === 'linux') {
        fs.chmodSync(installerPath, '755');
        const { shell } = require('electron');
        shell.showItemInFolder(installerPath);
      } else if (platform === 'darwin') {
        spawn('open', [installerPath], {
          detached: true,
          stdio: 'ignore',
        }).unref();
      } else {
        throw new Error('Unsupported platform');
      }
    } catch (err) {
      this.logger.error('Failed to run installer', err);
      throw err;
    }
  }

  /**
   * Check for updates and install if available
   * @returns {Promise<boolean>} true if update is being installed, false otherwise
   */
  async checkAndAutoUpdate() {
    if (!app.isPackaged) {
      this.logger.debug('Skipping update check in development mode');
      return false;
    }

    try {
      this.logger.info('Checking for updates');

      const releaseUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
      const release = await this.fetchJSON(releaseUrl);

      if (!release || !release.tag_name) {
        this.logger.info('No release found');
        return false;
      }

      const latestVersion = release.tag_name.replace(/^v/, '');

      this.logger.info('Version comparison', { current: this.currentVersion, latest: latestVersion });

      if (this.compareVersions(this.currentVersion, latestVersion) !== 1) {
        this.logger.info('Already up to date');
        return false;
      }

      this.logger.info('Update available');

      const asset = this.getInstallerAsset(release.assets || []);
      if (!asset) {
        this.logger.warn('No suitable installer found for this platform');
        return false;
      }

      this.logger.info('Downloading update', { asset: asset.name });

      this.createUpdaterWindow();

      await new Promise((resolve) => {
        this.updaterWindow.once('ready-to-show', resolve);
        this.updaterWindow.show();
      });

      this.sendProgress(0, 'Downloading update...');

      const tempPath = path.join(app.getPath('temp'), asset.name);
      await this.downloadFile(asset.browser_download_url, tempPath, (percent) => {
        this.sendProgress(percent, `Downloading update... ${percent}%`);
      });

      this.sendProgress(100, 'Verifying download...');
      await this.verifyIntegrity(tempPath);

      this.sendProgress(100, 'Installing update...');
      await new Promise((resolve) => setTimeout(resolve, 500));

      await this.installUpdate(tempPath);

      if (process.platform === 'win32') {
        this.logger.info('Installer launched, quitting app');
        app.quit();
        return true;
      } else {
        if (this.updaterWindow && !this.updaterWindow.isDestroyed()) {
          this.updaterWindow.close();
          this.updaterWindow = null;
        }
        return false;
      }
    } catch (error) {
      this.logger.error('Update check failed', error);

      if (this.updaterWindow && !this.updaterWindow.isDestroyed()) {
        this.updaterWindow.close();
        this.updaterWindow = null;
      }

      return false;
    }
  }

  /**
   * Get update info without installing
   * @returns {Promise<Object>} Update information
   */
  async getUpdateInfo() {
    try {
      const releaseUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
      const release = await this.fetchJSON(releaseUrl);

      if (!release || !release.tag_name) {
        return { updateAvailable: false, currentVersion: this.currentVersion };
      }

      const latestVersion = release.tag_name.replace(/^v/, '');
      const updateAvailable = this.compareVersions(this.currentVersion, latestVersion) === 1;

      return {
        updateAvailable,
        currentVersion: this.currentVersion,
        latestVersion,
        releaseUrl: release.html_url,
        releaseName: release.name,
        releaseNotes: release.body,
      };
    } catch (error) {
      this.logger.error('Failed to get update info', error);
      return { updateAvailable: false, currentVersion: this.currentVersion, error: error.message };
    }
  }
}

module.exports = AutoUpdaterService;
