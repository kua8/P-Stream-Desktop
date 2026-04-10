const DiscordRPC = require('discord-rpc');
const { ipcMain } = require('electron');

const clientId = '1451640447993774232';
DiscordRPC.register(clientId);

const rpc = new DiscordRPC.Client({ transport: 'ipc' });

const ACTIVITY_TYPE_WATCHING = 3;

function setActivityRaw(args) {
  if (!rpc || typeof rpc.request !== 'function') return Promise.resolve();
  if (!rpcReady) { attemptLogin(); return Promise.resolve(); }

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
    type: ACTIVITY_TYPE_WATCHING,
    name: args.name ?? 'P-Stream',
    state: args.state ?? undefined,
    details: args.details ?? undefined,
    timestamps,
    assets,
    buttons: args.buttons,
    instance: !!args.instance,
  };

  return rpc.request('SET_ACTIVITY', { pid: process.pid, activity })
    .catch((error) => { rpcReady = false; logRpcError('request', error); });
}

let currentMediaMetadata = null;
let currentActivityTitle = null;
let store = null;
let rpcReady = false;
let loginInFlight = false;
let lastLoginAttempt = 0;
const LOGIN_RETRY_MS = 10000;
let lastRpcErrorLog = 0;
const RPC_ERROR_LOG_MS = 60000;

function logRpcError(context, error) {
  const message = error?.message ? String(error.message) : String(error);
  if (message.toLowerCase().includes('could not connect')) return;
  const now = Date.now();
  if (now - lastRpcErrorLog < RPC_ERROR_LOG_MS) return;
  lastRpcErrorLog = now;
  console.warn(`Discord RPC ${context} failed:`, error);
}

function attemptLogin() {
  if (!rpc || typeof rpc.login !== 'function') return Promise.resolve(false);
  if (loginInFlight) return Promise.resolve(false);
  const now = Date.now();
  if (now - lastLoginAttempt < LOGIN_RETRY_MS) return Promise.resolve(false);
  loginInFlight = true;
  lastLoginAttempt = now;
  return rpc.login({ clientId })
    .then(() => { loginInFlight = false; return true; })
    .catch((error) => { loginInFlight = false; rpcReady = false; logRpcError('login', error); return false; });
}

function clearActivitySafe() {
  if (!rpc || typeof rpc.clearActivity !== 'function') return Promise.resolve();
  if (!rpcReady) return Promise.resolve();
  return rpc.clearActivity().catch((error) => { rpcReady = false; logRpcError('clear activity', error); });
}

function getStreamUrl() {
  if (!store) return 'https://pstream.net/';
  const u = store.get('streamUrl', 'pstream.net');
  return u.startsWith('http://') || u.startsWith('https://') ? u : `https://${u}/`;
}

function getCurrentMediaTitle(m) {
  if (!m?.title) return 'P-Stream';
  return m.artist ? `${m.artist} - ${m.title}` : m.title;
}

function getActivityName(m) {
  if (!m?.title) return 'P-Stream';
  return m.artist ? m.artist : m.title;
}

function getTimestamps(m) {
  if (!m || m.currentTime == null) return [undefined, undefined];
  const currentTimeSec = Number(m.currentTime);
  const durationSec = Number.isFinite(m.duration) ? Number(m.duration) : NaN;
  if (!Number.isFinite(durationSec) || durationSec <= 0) return [undefined, undefined];
  const nowMs = Date.now();
  const startMs = Math.round(nowMs - currentTimeSec * 1000);
  const endMs = Math.round(startMs + durationSec * 1000);
  return [startMs, endMs];
}

async function setActivity(title, mediaMetadata = null) {
  if (!rpc) return;
  if (store && !store.get('discordRPCEnabled', true)) { await clearActivitySafe(); return; }

  if (!mediaMetadata) {
    setActivityRaw({
      details: 'P-Stream',
      state: 'Browsing',
      startTimestamp: new Date(),
      largeImageKey: 'logo',
      largeImageText: 'P-Stream',
      instance: false,
      buttons: [{ label: 'Use P-Stream', url: getStreamUrl() }],
    });
    return;
  }

  const activity = {
    name: getActivityName(mediaMetadata),
    details: getCurrentMediaTitle(mediaMetadata),
    state: 'Loading...',
    startTimestamp: new Date(),
    largeImageKey: mediaMetadata.poster || 'logo',
    largeImageText: mediaMetadata.artist || mediaMetadata.title || 'P-Stream',
    smallImageKey: 'logo',
    smallImageText: 'P-Stream',
    instance: false,
    buttons: [{ label: 'Use P-Stream', url: getStreamUrl() }],
  };

  if (mediaMetadata.isPlaying) {
    const [startTimestamp, endTimestamp] = getTimestamps(mediaMetadata);
    if (startTimestamp != null) activity.startTimestamp = startTimestamp;
    if (endTimestamp != null) activity.endTimestamp = endTimestamp;
    activity.state = 'Watching';
  } else if (mediaMetadata.isPlaying === false) {
    activity.startTimestamp = new Date();
    activity.endTimestamp = undefined;
    activity.state = 'Paused';
  }

  setActivityRaw(activity);
}

function initialize(settingsStore) {
  store = settingsStore;

  rpc.on('ready', () => {
    console.log('[RPC] Discord connected');
    rpcReady = true;
    loginInFlight = false;
    if (!store || store.get('discordRPCEnabled', true)) {
      setActivity(currentActivityTitle, currentMediaMetadata);
    }
  });

  attemptLogin();

  ipcMain.handle('get-discord-rpc-enabled', () => store ? store.get('discordRPCEnabled', true) : true);

  ipcMain.handle('set-discord-rpc-enabled', async (event, enabled) => {
    if (!store) return false;
    store.set('discordRPCEnabled', enabled);
    if (enabled) await setActivity(currentActivityTitle, currentMediaMetadata);
    else await clearActivitySafe();
    return true;
  });

  ipcMain.handle('updateMediaMetadata', async (event, data) => {
    try {
      const hasMetadata = data?.metadata && (data.metadata.title || data.metadata.artist);
      const hasProgress = data?.progress && (data.progress.currentTime != null || data.progress.duration != null);

      if (!hasMetadata || !hasProgress) {
        currentMediaMetadata = null;
        setActivity(currentActivityTitle, null);
        return { success: true };
      }

      if (!currentMediaMetadata) currentMediaMetadata = {};

      if (data.metadata) {
        Object.assign(currentMediaMetadata, {
          title: data.metadata.title ?? currentMediaMetadata.title,
          artist: data.metadata.artist ?? currentMediaMetadata.artist,
          poster: data.metadata.poster ?? currentMediaMetadata.poster,
          season: data.metadata.season != null && !isNaN(data.metadata.season) ? data.metadata.season : currentMediaMetadata.season,
          episode: data.metadata.episode != null && !isNaN(data.metadata.episode) ? data.metadata.episode : currentMediaMetadata.episode,
        });
      }

      if (data.progress) {
        Object.assign(currentMediaMetadata, {
          currentTime: data.progress.currentTime != null && !isNaN(data.progress.currentTime) ? data.progress.currentTime : currentMediaMetadata.currentTime,
          duration: data.progress.duration != null && !isNaN(data.progress.duration) ? data.progress.duration : currentMediaMetadata.duration,
          isPlaying: data.progress.isPlaying ?? currentMediaMetadata.isPlaying,
        });
      }

      await setActivity(currentActivityTitle, currentMediaMetadata);
      return { success: true };
    } catch (error) {
      console.error('[RPC] Error updating media metadata:', error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = {
  initialize,
  setActivity,
  clearActivity: clearActivitySafe,
};