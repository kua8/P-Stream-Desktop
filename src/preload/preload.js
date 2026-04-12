const { contextBridge, ipcRenderer } = require('electron');

// Valid IPC channels for message relay
const VALID_CHANNELS = ['updateMediaMetadata', 'hello', 'openPage', 'prepareStream', 'makeRequest'];

// Message relay system for web app communication
window.addEventListener('message', async (event) => {
  // Security check: only accept messages from the same window
  if (event.source !== window) return;

  const data = event.data;

  // Check for valid channel and prevent relay loops
  if (!data || !data.name || data.relayed) return;

  console.log('[Preload] postMessage received:', data.name);

  if (VALID_CHANNELS.includes(data.name)) {
    try {
      // Forward to Main Process
      const response = await ipcRenderer.invoke(data.name, data.body);

      // updateMediaMetadata is one-way, no reply needed
      if (data.name !== 'updateMediaMetadata') {
        window.postMessage(
          {
            name: data.name,
            relayId: data.relayId,
            instanceId: data.instanceId,
            body: response,
            relayed: true,
          },
          '*',
        );
      }
    } catch (error) {
      console.error(`[Preload] Error handling ${data.name}:`, error);
      if (data.name !== 'updateMediaMetadata') {
        window.postMessage(
          {
            name: data.name,
            relayId: data.relayId,
            instanceId: data.instanceId,
            body: { success: false, error: error.message },
            relayed: true,
          },
          '*',
        );
      }
    }
  }
});

contextBridge.exposeInMainWorld('__PSTREAM_DESKTOP__', true);
contextBridge.exposeInMainWorld('__MW_DESKTOP__', true);
contextBridge.exposeInMainWorld('__SUDO_DESKTOP__', true);

contextBridge.exposeInMainWorld('electronAPI', {
  openSettings: () => ipcRenderer.send('open-settings'),
  setUrl: (url) => ipcRenderer.send('set-url', url),
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  maximizeWindow: () => ipcRenderer.send('maximize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),
  resetUrl: () => ipcRenderer.send('reset-url'),
  onTitleUpdate: (callback) => ipcRenderer.on('update-title', (_e, title) => callback(title)),
});

contextBridge.exposeInMainWorld('PSTREAMSETUP', {
  saveDomain: (domain) => ipcRenderer.invoke('save-domain', domain),
});

contextBridge.exposeInMainWorld('desktopApi', {
  startDownload: (data) => ipcRenderer.invoke('start-download', data),
  openOffline: () => ipcRenderer.invoke('open-offline'),
});

contextBridge.exposeInMainWorld('settings', {
  getStreamUrl: () => ipcRenderer.invoke('get-stream-url'),
  setStreamUrl: (url) => ipcRenderer.invoke('set-stream-url', url),
  getVersion: () => ipcRenderer.invoke('get-version'),
  resetApp: () => ipcRenderer.invoke('reset-app'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  openReleasesPage: () => ipcRenderer.invoke('open-releases-page'),
  setDiscordRPCEnabled: (val) => ipcRenderer.invoke('set-discord-rpc', val),
  getDiscordRPCEnabled: () => ipcRenderer.invoke('get-discord-rpc'),
  setWarpEnabled: (val) => ipcRenderer.invoke('set-warp', val),
  setWarpLaunchEnabled: (val) => ipcRenderer.invoke('set-warp-launch', val),
  getWarpLaunchEnabled: () => ipcRenderer.invoke('get-warp-launch'),
  getWarpStatus: () => ipcRenderer.invoke('get-warp-status'),
  setHardwareAcceleration: (val) => ipcRenderer.invoke('set-hw-accel', val),
  getHardwareAcceleration: () => ipcRenderer.invoke('get-hw-accel'),
  setVolumeBoost: (val) => ipcRenderer.invoke('set-volume-boost', val),
  getVolumeBoost: () => ipcRenderer.invoke('get-volume-boost'),
  restartApp: () => ipcRenderer.invoke('restart-app'),
  uninstallApp: () => ipcRenderer.invoke('uninstall-app'),
  closeSettings: () => ipcRenderer.invoke('close-settings'),
  onProgress: (cb) => ipcRenderer.on('update-progress', (_e, data) => cb(data)),
});

// Expose updateMediaMetadata for Discord RPC
contextBridge.exposeInMainWorld('updateMediaMetadata', (data) => {
  return ipcRenderer.invoke('updateMediaMetadata', data);
});

// Inject postMessage hook before page scripts run
function injectEarlyScript() {
  const script = document.createElement('script');
  script.textContent = `
    Object.defineProperty(window, '__activeExtension', {
      value: true, writable: false, configurable: false
    });
    const _origPostMessage = window.postMessage.bind(window);
    window.postMessage = function(data, ...args) {
      _origPostMessage(data, ...args);
      // Only auto-reply to hello/handshake messages, never to updateMediaMetadata
      if (data && data.name !== 'updateMediaMetadata' &&
          (data.relayId || data.name === 'hello' || JSON.stringify(data)?.includes('hello'))) {
        setTimeout(() => {
          _origPostMessage({
            relayId: data.relayId,
            name: data.name,
            body: { success: true, allowed: true, hasPermission: true, version: '2.0.0' }
          }, '*');
        }, 50);
      }
    };
  `;
  (document.head || document.documentElement)?.appendChild(script);
  script.remove();
}

// Inject P-Stream userscript for additional sources
function injectUserscript() {
  const script = document.createElement('script');
  script.src = 'https://raw.githubusercontent.com/xp-technologies-dev/userscript/main/p-stream.user.js';
  (document.head || document.documentElement)?.appendChild(script);
}

// Site injection for native app detection
function patchSite() {
  document.querySelectorAll('*').forEach(el => {
    if (el.children.length === 0 && el.textContent?.trim() === 'Native app') {
      const row = el.closest('li, [class*="item"], [class*="row"], div') || el.parentElement;
      if (!row) return;
      const indicator = row.querySelector('[class*="circle"], [class*="status"], [class*="dot"], svg');
      if (indicator) {
        indicator.style.cssText += 'color:#4ade80!important;fill:#4ade80!important;stroke:#4ade80!important;';
        const wrap = indicator.parentElement;
        if (wrap) wrap.style.cssText += 'color:#4ade80!important;';
      }
      const banner = document.querySelector('[class*="setup"][class*="card"], [class*="warning"], [class*="banner"]');
      if (banner && banner.textContent?.includes("haven't gone through setup")) {
        banner.style.display = 'none';
      }
    }
  });
}

// Initialize on DOM ready
window.addEventListener('DOMContentLoaded', () => {
  injectEarlyScript();
  injectUserscript();

  const observer = new MutationObserver(patchSite);
  observer.observe(document.body, { childList: true, subtree: true });
  patchSite();

  document.addEventListener('click', (e) => {
    const el = e.target.closest('button, a, li, [role="button"], [role="menuitem"]');
    if (!el) return;
    const text = el.textContent?.trim().replace(/\s+/g, ' ');
    if (text === 'App Settings' || (text?.includes('App Settings') && text.length < 30)) {
      e.preventDefault();
      e.stopPropagation();
      ipcRenderer.send('open-settings');
    } else if (text === 'Offline Downloads' || text?.includes('Offline Downloads')) {
      e.preventDefault();
      e.stopPropagation();
      ipcRenderer.invoke('open-offline');
    }
  }, true);
});

// Extension detection flags
contextBridge.exposeInMainWorld('__EXTENSION_ACTIVE__', true);
contextBridge.exposeInMainWorld('__PSTREAM_EXTENSION__', true);
contextBridge.exposeInMainWorld('__PSTREAM_EXTENSION_CACHED__', true);

contextBridge.exposeInMainWorld('__pstreamExtension', {
  isActive: () => true,
  sendMessage: () => Promise.resolve({ success: true }),
});

window.addEventListener('DOMContentLoaded', () => {
  window.__EXTENSION_ACTIVE__ = true;

  window.addEventListener('pstream-extension-ping', () => {
    window.dispatchEvent(new CustomEvent('pstream-extension-pong', {
      detail: { active: true }
    }));
  });

  window.addEventListener('message', (e) => {
    if (e.data?.type === 'PSTREAM_EXTENSION_CHECK' || e.data?.type === 'MW_EXTENSION_CHECK') {
      window.postMessage({ type: 'PSTREAM_EXTENSION_RESPONSE', active: true }, '*');
    }
  });
});

console.log('P-Stream Desktop Preload Loaded');
