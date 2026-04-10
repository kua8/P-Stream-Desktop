// NAV
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('page-' + btn.dataset.page).classList.add('active');
  });
});

document.getElementById('close-btn').addEventListener('click', () => window.close());

// FEEDBACK HELPER
function setFeedback(id, msg, type = 'success') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className = 'feedback ' + type;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 3000);
}

// WARP STATUS
function setWarpStatusText(status) {
  const el = document.getElementById('warp-status');
  if (!el) return;
  if (status.enabled) {
    el.textContent = `Connected via ${status.proxyHost}:${status.proxyPort}`;
    el.className = 'status-text connected';
  } else if (status.error) {
    el.textContent = `Error: ${status.error}`;
    el.className = 'status-text error';
  } else {
    el.textContent = 'Disabled';
    el.className = 'status-text';
  }
}

// LOAD ALL STATE
async function loadState() {
  if (!window.settings) return;
  try {
    const v = await window.settings.getVersion();
    document.getElementById('version-text').textContent = `v${v}`;
  } catch {}
  try {
    const url = await window.settings.getStreamUrl();
    if (url) {
      document.getElementById('stream-url-input').value = url;
      document.getElementById('page-url-input').value = url;
      document.getElementById('stat-backend').textContent = url;
    }
    document.getElementById('stat-hostname').textContent = window.location.hostname || 'pstream.net';
  } catch {}
  try {
    const ws = await window.settings.getWarpStatus();
    document.getElementById('warp-toggle').checked = !!ws.enabled;
    setWarpStatusText(ws);
  } catch {}
  try {
    const d = await window.settings.getDiscordRPCEnabled?.();
    if (typeof d === 'boolean') document.getElementById('discord-toggle').checked = d;
  } catch {}
  try {
    const hw = await window.settings.getHardwareAcceleration?.();
    if (typeof hw === 'boolean') document.getElementById('hwaccel-toggle').checked = hw;
  } catch {}
  try {
    const vol = await window.settings.getVolumeBoost?.();
    if (typeof vol === 'number') {
      document.getElementById('vol-slider').value = vol;
      document.getElementById('vol-label').textContent = `${vol.toFixed(1)}×`;
    }
  } catch {}
  try {
    const wl = await window.settings.getWarpLaunchEnabled?.();
    if (typeof wl === 'boolean') document.getElementById('warp-launch-toggle').checked = wl;
  } catch {}
}

// WARP TOGGLE
document.getElementById('warp-toggle').addEventListener('change', async e => {
  const enabling = e.target.checked;
  e.target.disabled = true;
  const el = document.getElementById('warp-status');
  el.textContent = enabling ? 'Connecting...' : 'Disconnecting...';
  el.className = 'status-text connecting';
  try {
    const r = await window.settings.setWarpEnabled(enabling);
    if (r.success) {
      await window.settings.getWarpStatus().then(setWarpStatusText).catch(() => {});
    } else {
      e.target.checked = !enabling;
      el.textContent = r.error || 'Failed';
      el.className = 'status-text error';
    }
  } catch (err) {
    e.target.checked = !enabling;
    el.textContent = err.message || 'Failed';
    el.className = 'status-text error';
  } finally {
    e.target.disabled = false;
  }
});

// WARP ON LAUNCH
document.getElementById('warp-launch-toggle').addEventListener('change', async e => {
  try { await window.settings.setWarpLaunchEnabled(e.target.checked); }
  catch { e.target.checked = !e.target.checked; }
});

// DISCORD RPC
document.getElementById('discord-toggle').addEventListener('change', async e => {
  try { await window.settings.setDiscordRPCEnabled(e.target.checked); }
  catch { e.target.checked = !e.target.checked; }
});

// HARDWARE ACCELERATION
document.getElementById('hwaccel-toggle').addEventListener('change', async e => {
  const enabling = e.target.checked;
  e.target.disabled = true;
  try {
    const r = await window.settings.setHardwareAcceleration(enabling);
    if (r.success) {
      if (confirm('Hardware acceleration changed. Restart now?')) await window.settings.restartApp();
    } else {
      e.target.checked = !enabling;
    }
  } catch { e.target.checked = !enabling; }
  finally { e.target.disabled = false; }
});

// VOLUME BOOST
document.getElementById('vol-slider').addEventListener('input', e => {
  document.getElementById('vol-label').textContent = `${Number(e.target.value).toFixed(1)}×`;
});
document.getElementById('vol-slider').addEventListener('change', async e => {
  const v = Math.min(Math.max(Number(e.target.value), 1), 10);
  try {
    const r = await window.settings.setVolumeBoost(v);
    if (r?.success && typeof r.value === 'number') {
      document.getElementById('vol-slider').value = r.value;
      document.getElementById('vol-label').textContent = `${r.value.toFixed(1)}×`;
    }
  } catch {}
});

// SAVE URL HELPER
async function saveUrl(inputId, feedbackId, btnId) {
  const btn = document.getElementById(btnId);
  const url = document.getElementById(inputId).value.trim();
  if (!url) { setFeedback(feedbackId, 'Please enter a valid URL.', 'error'); return; }
  btn.disabled = true; btn.textContent = 'Saving...';
  try {
    await window.settings.setStreamUrl(url);
    btn.textContent = 'Saved!';
    setFeedback(feedbackId, '✓ Saved — restart to apply', 'success');
    document.getElementById('stat-backend').textContent = url;
    setTimeout(() => { btn.textContent = 'Save'; btn.disabled = false; }, 2000);
  } catch {
    btn.textContent = 'Save'; btn.disabled = false;
    setFeedback(feedbackId, 'Failed to save.', 'error');
  }
}

document.getElementById('save-url-btn').addEventListener('click', () => saveUrl('stream-url-input', 'url-feedback', 'save-url-btn'));
document.getElementById('stream-url-input').addEventListener('keypress', e => { if (e.key === 'Enter') document.getElementById('save-url-btn').click(); });
document.getElementById('save-page-url-btn').addEventListener('click', () => saveUrl('page-url-input', 'page-url-feedback', 'save-page-url-btn'));
document.getElementById('page-url-input').addEventListener('keypress', e => { if (e.key === 'Enter') document.getElementById('save-page-url-btn').click(); });

// RESET APP
document.getElementById('reset-app-btn').addEventListener('click', async () => {
  if (!confirm('Clear all local data and cookies? Cannot be undone.')) return;
  const btn = document.getElementById('reset-app-btn');
  btn.disabled = true; btn.textContent = 'Resetting...';
  try {
    await window.settings.resetApp();
    alert('Reset complete.');
    setTimeout(() => window.location.reload(), 1000);
  } catch { btn.textContent = 'Reset App'; btn.disabled = false; }
});

// UNINSTALL
document.getElementById('uninstall-btn').addEventListener('click', async () => {
  if (!confirm('Permanently delete P-Stream and all data? Cannot be undone.')) return;
  if (!confirm('Final confirmation: uninstall P-Stream?')) return;
  const btn = document.getElementById('uninstall-btn');
  btn.disabled = true; btn.textContent = 'Uninstalling...';
  try {
    const r = await window.settings.uninstallApp();
    if (!r.success) { btn.textContent = 'Uninstall App'; btn.disabled = false; }
  } catch { btn.textContent = 'Uninstall App'; btn.disabled = false; }
});

// CHECK FOR UPDATES
document.getElementById('check-updates-btn').addEventListener('click', async () => {
  const btn = document.getElementById('check-updates-btn');
  if (btn.textContent === 'Open Releases Page') {
    try { await window.settings.openReleasesPage(); } catch {}
    return;
  }
  btn.disabled = true; btn.textContent = 'Checking...';
  try {
    const r = await window.settings.checkForUpdates();
    const verEl = document.getElementById('version-text');
    if (r.updateAvailable) {
      verEl.textContent = `Update available: v${r.version}`;
      document.getElementById('update-now-btn').hidden = false;
      btn.textContent = 'Open Releases Page';
    } else if (r.isDevelopment) {
      verEl.textContent = `v${r.version} (Dev Mode)`;
      btn.textContent = 'Open Releases Page';
    } else {
      verEl.textContent = `v${r.version || r.currentVersion} — Up to date`;
      btn.textContent = 'Check for Updates';
    }
  } catch {
    document.getElementById('version-text').textContent = 'Error checking for updates';
    btn.textContent = 'Check for Updates';
  } finally { btn.disabled = false; }
});

// UPDATE NOW
document.getElementById('update-now-btn').addEventListener('click', async () => {
  const btn = document.getElementById('update-now-btn');
  btn.disabled = true; btn.textContent = 'Updating...';
  try {
    const r = await window.settings.installUpdate();
    if (!r.updateInstalling) { btn.disabled = false; btn.textContent = 'Update now'; }
  } catch { btn.disabled = false; btn.textContent = 'Update now'; }
});

loadState();