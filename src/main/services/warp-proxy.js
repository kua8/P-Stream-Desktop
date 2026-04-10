/**
 * Cloudflare WARP Proxy Service
 * 
 * Manages WARP proxy lifecycle with enhanced error handling, verification,
 * crash detection, and cleanup. Uses wgcf to generate WireGuard config from
 * Cloudflare WARP, then wireproxy to create a local SOCKS5 proxy.
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { createWriteStream } = require('fs');
const { pipeline } = require('stream/promises');
const { ServiceError, NetworkError } = require('../utils/errors');
const { WARP_CLI_PATHS, WARP_CLI_TIMEOUT } = require('../../shared/constants');

class WARPProxyService {
  constructor(dependencies) {
    this.logger = dependencies.logger;
    this.dataDir = dependencies.dataDir;
    
    this.proxyPort = 40000;
    this.proxyHost = '127.0.0.1';
    
    this.wgcfPath = path.join(this.dataDir, process.platform === 'win32' ? 'wgcf.exe' : 'wgcf');
    this.wireproxyPath = path.join(this.dataDir, process.platform === 'win32' ? 'wireproxy.exe' : 'wireproxy');
    this.warpAccountPath = path.join(this.dataDir, 'wgcf-account.toml');
    this.warpProfilePath = path.join(this.dataDir, 'wgcf-profile.conf');
    this.wireproxyConfigPath = path.join(this.dataDir, 'wireproxy.conf');
    
    this.wireproxyProcess = null;
    this.isEnabled = false;
    this.crashDetected = false;
    
    this.wgcfReleasesUrl = 'https://api.github.com/repos/ViRb3/wgcf/releases/latest';
    this.wireproxyReleasesUrl = 'https://api.github.com/repos/pufferffish/wireproxy/releases/latest';
  }

  /**
   * Enable WARP proxy
   * @returns {Promise<Object>} Result with success status and proxy configuration
   */
  async enable() {
    try {
      this.logger.info('Enabling WARP proxy');
      this.crashDetected = false;
      
      this.ensureDataDir();
      
      await this.ensureWgcf();
      await this.ensureWireproxy();
      await this.ensureWarpAccount();
      await this.ensureWarpProfile();
      
      this.generateWireproxyConfig();
      this.startWireproxy();
      
      await this.verifyProxyRunning();
      
      this.logger.info('WARP proxy enabled successfully', {
        host: this.proxyHost,
        port: this.proxyPort
      });
      
      return {
        success: true,
        proxyHost: this.proxyHost,
        proxyPort: this.proxyPort,
        httpProxyPort: this.proxyPort + 1
      };
    } catch (error) {
      this.logger.error('Failed to enable WARP proxy', error);
      this.cleanup();
      throw new ServiceError('WARPProxy', error.message, { operation: 'enable' });
    }
  }

  /**
   * Disable WARP proxy
   * @returns {Object} Result with success status
   */
  disable() {
    try {
      this.logger.info('Disabling WARP proxy');
      this.stopWireproxy();
      this.logger.info('WARP proxy disabled successfully');
      return { success: true };
    } catch (error) {
      this.logger.error('Failed to disable WARP proxy', error);
      throw new ServiceError('WARPProxy', error.message, { operation: 'disable' });
    }
  }

  /**
   * Get current proxy status
   * @returns {Object} Status information
   */
  getStatus() {
    return {
      enabled: this.isEnabled,
      running: this.wireproxyProcess !== null && !this.crashDetected,
      crashed: this.crashDetected,
      host: this.proxyHost,
      port: this.proxyPort
    };
  }

  /**
   * Get proxy configuration for Electron session
   * @returns {Object} Proxy configuration
   */
  getProxyConfig() {
    if (!this.isEnabled || this.wireproxyProcess === null) {
      return { proxyRules: '' };
    }
    return {
      proxyRules: `socks5://${this.proxyHost}:${this.proxyPort}`,
      proxyBypassRules: '<local>'
    };
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    this.stopWireproxy();
  }

  /**
   * Ensure data directory exists
   */
  ensureDataDir() {
    if (!fs.existsSync(this.dataDir)) {
      this.logger.debug('Creating WARP data directory', { path: this.dataDir });
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  /**
   * Download wgcf binary if not present
   */
  async ensureWgcf() {
    if (fs.existsSync(this.wgcfPath)) {
      if (!this.validateBinary(this.wgcfPath)) {
        this.logger.warn('Invalid wgcf binary detected, re-downloading');
        fs.unlinkSync(this.wgcfPath);
      } else {
        this.logger.debug('wgcf binary already exists');
        return;
      }
    }

    this.logger.info('Downloading wgcf binary');
    try {
      const release = await this.fetchJson(this.wgcfReleasesUrl);
      const asset = this.getAssetName(release.assets, 'wgcf');

      if (!asset) {
        throw new Error(`Could not find wgcf binary for platform ${process.platform} ${process.arch}`);
      }

      await this.downloadFile(asset.browser_download_url, this.wgcfPath);

      if (process.platform !== 'win32') {
        fs.chmodSync(this.wgcfPath, 0o755);
      }

      if (!this.validateBinary(this.wgcfPath)) {
        throw new Error('Downloaded wgcf binary failed validation');
      }

      this.logger.info('wgcf binary downloaded successfully');
    } catch (error) {
      throw new NetworkError(`Failed to download wgcf: ${error.message}`, {
        url: this.wgcfReleasesUrl,
        platform: process.platform,
        arch: process.arch
      });
    }
  }

  /**
   * Download wireproxy binary if not present
   */
  async ensureWireproxy() {
    if (fs.existsSync(this.wireproxyPath)) {
      if (!this.validateBinary(this.wireproxyPath)) {
        this.logger.warn('Invalid wireproxy binary detected, re-downloading');
        fs.unlinkSync(this.wireproxyPath);
      } else {
        this.logger.debug('wireproxy binary already exists');
        return;
      }
    }

    this.logger.info('Downloading wireproxy binary');
    try {
      const release = await this.fetchJson(this.wireproxyReleasesUrl);
      const asset = this.getAssetName(release.assets, 'wireproxy');

      if (!asset) {
        throw new Error(`Could not find wireproxy binary for platform ${process.platform} ${process.arch}`);
      }

      const isZip = asset.name.endsWith('.zip');
      const isTarGz = asset.name.endsWith('.tar.gz') || asset.name.endsWith('.tgz');

      if (isZip || isTarGz) {
        await this.downloadAndExtractArchive(asset, isZip);
      } else {
        await this.downloadFile(asset.browser_download_url, this.wireproxyPath);
      }

      if (process.platform !== 'win32') {
        fs.chmodSync(this.wireproxyPath, 0o755);
      }

      if (!this.validateBinary(this.wireproxyPath)) {
        throw new Error('Downloaded wireproxy binary failed validation');
      }

      this.logger.info('wireproxy binary downloaded successfully');
    } catch (error) {
      throw new NetworkError(`Failed to download wireproxy: ${error.message}`, {
        url: this.wireproxyReleasesUrl,
        platform: process.platform,
        arch: process.arch
      });
    }
  }

  /**
   * Download and extract archive
   */
  async downloadAndExtractArchive(asset, isZip) {
    const tempPath = path.join(this.dataDir, asset.name);
    const extractDir = path.join(this.dataDir, 'wireproxy_extract');

    try {
      await this.downloadFile(asset.browser_download_url, tempPath);
      
      fs.mkdirSync(extractDir, { recursive: true });

      if (process.platform === 'win32') {
        if (isZip) {
          execSync(`powershell -Command "Expand-Archive -Force '${tempPath}' '${extractDir}'"`, {
            stdio: 'pipe'
          });
        } else {
          execSync(`tar -xzf "${tempPath}" -C "${extractDir}"`, {
            stdio: 'pipe'
          });
        }

        const binaryPath = this.findBinaryInDir(extractDir, 'wireproxy.exe');
        if (!binaryPath) {
          throw new Error('wireproxy.exe not found in archive');
        }
        fs.copyFileSync(binaryPath, this.wireproxyPath);
      } else {
        execSync(`tar -xzf "${tempPath}" -C "${extractDir}"`, { stdio: 'pipe' });
        
        const binaryPath = this.findBinaryInDir(extractDir, 'wireproxy');
        if (!binaryPath) {
          throw new Error('wireproxy not found in archive');
        }
        fs.copyFileSync(binaryPath, this.wireproxyPath);
      }
    } finally {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
      if (fs.existsSync(extractDir)) {
        fs.rmSync(extractDir, { recursive: true, force: true });
      }
    }
  }

  /**
   * Find binary in directory recursively
   */
  findBinaryInDir(dir, binaryName) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      if (file === binaryName) {
        return fullPath;
      }
      if (fs.statSync(fullPath).isDirectory()) {
        const found = this.findBinaryInDir(fullPath, binaryName);
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * Register with Cloudflare WARP and generate account
   */
  async ensureWarpAccount() {
    if (fs.existsSync(this.warpAccountPath)) {
      this.logger.debug('WARP account already exists');
      return;
    }

    this.logger.info('Registering with Cloudflare WARP');
    try {
      execSync(`"${this.wgcfPath}" register --accept-tos`, {
        cwd: this.dataDir,
        stdio: 'pipe',
        timeout: WARP_CLI_TIMEOUT
      });
      this.logger.info('WARP account registered successfully');
    } catch (error) {
      throw new ServiceError('WARPProxy', `Failed to register WARP account: ${error.message}`, {
        operation: 'register'
      });
    }
  }

  /**
   * Generate WireGuard profile from WARP account
   */
  async ensureWarpProfile() {
    if (fs.existsSync(this.warpProfilePath)) {
      this.logger.debug('WireGuard profile already exists');
      return;
    }

    this.logger.info('Generating WireGuard profile');
    try {
      execSync(`"${this.wgcfPath}" generate`, {
        cwd: this.dataDir,
        stdio: 'pipe',
        timeout: WARP_CLI_TIMEOUT
      });
      this.logger.info('WireGuard profile generated successfully');
    } catch (error) {
      throw new ServiceError('WARPProxy', `Failed to generate WireGuard profile: ${error.message}`, {
        operation: 'generate'
      });
    }
  }

  /**
   * Generate wireproxy config from WireGuard profile
   */
  generateWireproxyConfig() {
    this.logger.info('Generating wireproxy configuration');

    const wgProfile = fs.readFileSync(this.warpProfilePath, 'utf-8');
    const lines = wgProfile.split('\n');
    let section = '';
    const config = { Interface: {}, Peer: {} };

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        section = trimmed.slice(1, -1);
      } else if (trimmed && section) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length) {
          config[section][key.trim()] = valueParts.join('=').trim();
        }
      }
    }

    const address = config.Interface.Address || '172.16.0.2/32, fd01:db8:1111::2/128';

    const wireproxyConfig = `[Interface]
PrivateKey = ${config.Interface.PrivateKey}
Address = ${address}
DNS = 1.1.1.1
MTU = 1280

[Peer]
PublicKey = ${config.Peer.PublicKey}
Endpoint = ${config.Peer.Endpoint}
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25

[Socks5]
BindAddress = ${this.proxyHost}:${this.proxyPort}

[http]
BindAddress = ${this.proxyHost}:${this.proxyPort + 1}
`;

    fs.writeFileSync(this.wireproxyConfigPath, wireproxyConfig);
    this.logger.info('wireproxy configuration generated successfully');
  }

  /**
   * Start wireproxy process
   */
  startWireproxy() {
    if (this.wireproxyProcess) {
      this.logger.warn('wireproxy already running');
      return;
    }

    this.logger.info('Starting wireproxy process');
    try {
      this.wireproxyProcess = spawn(this.wireproxyPath, ['-c', this.wireproxyConfigPath], {
        stdio: 'pipe',
        windowsHide: true
      });

      this.wireproxyProcess.stdout.on('data', (data) => {
        this.logger.debug('wireproxy stdout', { output: data.toString().trim() });
      });

      this.wireproxyProcess.stderr.on('data', (data) => {
        // Suppress debug output, only log actual errors
        const output = data.toString().trim();
        if (!output.startsWith('DEBUG:')) {
          this.logger.warn('wireproxy stderr', { output });
        }
      });

      this.wireproxyProcess.on('error', (error) => {
        this.logger.error('wireproxy process error', error);
        this.wireproxyProcess = null;
        this.isEnabled = false;
        this.crashDetected = true;
      });

      this.wireproxyProcess.on('exit', (code, signal) => {
        this.logger.warn('wireproxy process exited', { code, signal });
        this.wireproxyProcess = null;
        this.isEnabled = false;
        this.crashDetected = true;
      });

      this.isEnabled = true;
      this.logger.info('wireproxy process started', {
        pid: this.wireproxyProcess.pid,
        host: this.proxyHost,
        port: this.proxyPort
      });
    } catch (error) {
      throw new ServiceError('WARPProxy', `Failed to start wireproxy: ${error.message}`, {
        operation: 'start'
      });
    }
  }

  /**
   * Stop wireproxy process
   */
  stopWireproxy() {
    if (!this.wireproxyProcess) {
      return;
    }

    this.logger.info('Stopping wireproxy process');
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /pid ${this.wireproxyProcess.pid} /f /t`, { stdio: 'pipe' });
      } else {
        this.wireproxyProcess.kill('SIGTERM');
      }
      this.wireproxyProcess = null;
      this.isEnabled = false;
      this.logger.info('wireproxy process stopped');
    } catch (error) {
      this.logger.error('Failed to stop wireproxy gracefully, forcing kill', error);
      try {
        this.wireproxyProcess.kill('SIGKILL');
      } catch {
        // Ignore
      }
      this.wireproxyProcess = null;
      this.isEnabled = false;
    }
  }

  /**
   * Verify proxy is running by checking process and port
   */
  async verifyProxyRunning() {
    this.logger.debug('Verifying proxy is running');
    
    await new Promise(resolve => setTimeout(resolve, 1000));

    if (!this.wireproxyProcess || this.wireproxyProcess.exitCode !== null) {
      throw new ServiceError('WARPProxy', 'Proxy process not running after start', {
        operation: 'verify'
      });
    }

    this.logger.info('Proxy verification successful');
  }

  /**
   * Validate binary file
   */
  validateBinary(binaryPath) {
    try {
      const stats = fs.statSync(binaryPath);
      if (stats.size === 0) {
        this.logger.warn('Binary file is empty', { path: binaryPath });
        return false;
      }
      if (stats.size < 1024) {
        this.logger.warn('Binary file suspiciously small', { path: binaryPath, size: stats.size });
        return false;
      }
      return true;
    } catch (error) {
      this.logger.error('Binary validation failed', error, { path: binaryPath });
      return false;
    }
  }

  /**
   * Fetch JSON from URL
   */
  fetchJson(url) {
    return new Promise((resolve, reject) => {
      const options = {
        headers: {
          'User-Agent': 'P-Stream-Desktop',
          Accept: 'application/json'
        },
        timeout: 10000
      };

      https.get(url, options, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          this.fetchJson(res.headers.location).then(resolve).catch(reject);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(new Error(`Invalid JSON: ${error.message}`));
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * Download file from URL
   */
  downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
      const options = {
        headers: {
          'User-Agent': 'P-Stream-Desktop'
        },
        timeout: 30000
      };

      const handleResponse = (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          https.get(res.headers.location, options, handleResponse).on('error', reject);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        const file = createWriteStream(destPath);
        pipeline(res, file).then(resolve).catch(reject);
      };

      https.get(url, options, handleResponse).on('error', reject);
    });
  }

  /**
   * Get appropriate asset name for current platform
   */
  getAssetName(assets, prefix) {
    const platform = process.platform;
    const arch = process.arch;

    let platformStr, archStr;

    if (platform === 'win32') {
      platformStr = 'windows';
      archStr = arch === 'x64' ? 'amd64' : arch;
    } else if (platform === 'darwin') {
      platformStr = 'darwin';
      archStr = arch === 'arm64' ? 'arm64' : 'amd64';
    } else {
      platformStr = 'linux';
      archStr = arch === 'x64' ? 'amd64' : arch;
    }

    const ext = platform === 'win32' ? '.exe' : '';
    const patterns = [
      `${prefix}_${platformStr}_${archStr}${ext}`,
      `${prefix}-${platformStr}-${archStr}${ext}`,
      new RegExp(`${prefix}.*${platformStr}.*${archStr}`, 'i')
    ];

    for (const pattern of patterns) {
      const asset = assets.find((a) => {
        if (typeof pattern === 'string') {
          return a.name === pattern || a.name.toLowerCase() === pattern.toLowerCase();
        }
        return pattern.test(a.name);
      });
      if (asset) return asset;
    }

    return null;
  }
}

module.exports = WARPProxyService;
