const { contextBridge, ipcRenderer } = require('electron');

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
// Inject postMessage hook before page scripts run
// Use 'document-start' equivalent by waiting for documentElement to exist
function injectEarlyScript() {
  const script = document.createElement('script');
  script.textContent = `
    Object.defineProperty(window, '__activeExtension', {
      value: true, writable: false, configurable: false
    });
    const _origPostMessage = window.postMessage.bind(window);
    window.postMessage = function(data, ...args) {
      _origPostMessage(data, ...args);
      if (data && (data.relayId || data.name === 'hello' ||
          JSON.stringify(data)?.includes('hello'))) {
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
// ── SITE INJECTION ──
function patchSite() {
  // 1. Auto-mark Native app as active on Connections page
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

// Single, non-stacking click interceptor attached once at DOMContentLoaded
window.addEventListener('DOMContentLoaded', () => {
  injectEarlyScript();

  const observer = new MutationObserver(patchSite);
  observer.observe(document.body, { childList: true, subtree: true });
  patchSite();

  document.addEventListener('click', (e) => {
    const el = e.target.closest('button, a, li, [role="button"], [role="menuitem"]');
    if (!el) return;
    const text = el.textContent?.trim().replace(/\s+/g, ' ');
    console.log('[PSTREAM] clicked element text:', JSON.stringify(text));
    if (text === 'App Settings' || (text?.includes('App Settings') && text.length < 30)) {
      console.log('[PSTREAM] sending open-settings via ipcRenderer');
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



// Makes isExtensionActive() return true — this is what drives the Native app green checkmark
contextBridge.exposeInMainWorld('__EXTENSION_ACTIVE__', true);

// The site calls chrome.runtime or a custom event to check extension status.
// Intercept it via the messaging bridge the site uses:
contextBridge.exposeInMainWorld('__pstreamExtension', {
  isActive: () => true,
  sendMessage: (msg) => Promise.resolve({ success: true }),
});

window.addEventListener('DOMContentLoaded', () => {
    // Fake the extension active flag via every known method
    window.__EXTENSION_ACTIVE__ = true;
  
    // If the site uses a CustomEvent to ping the extension, respond to it
    window.addEventListener('pstream-extension-ping', () => {
      window.dispatchEvent(new CustomEvent('pstream-extension-pong', {
        detail: { active: true }
      }));
    });
  
    // Also handle any postMessage-based extension checks
    window.addEventListener('message', (e) => {
      if (e.data?.type === 'PSTREAM_EXTENSION_CHECK' || e.data?.type === 'MW_EXTENSION_CHECK') {
        window.postMessage({ type: 'PSTREAM_EXTENSION_RESPONSE', active: true }, '*');
      }
    });
  });

  contextBridge.exposeInMainWorld('__PSTREAM_EXTENSION__', true);
  contextBridge.exposeInMainWorld('__PSTREAM_EXTENSION_CACHED__', true);