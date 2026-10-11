export function startRemoteClientUpdates({ version, installButton, isConnected, reload = () => location.reload() }) {
  let pendingInstall, checking = null, reloading = false, stopped = false;
  const install = event => {
    event.preventDefault(); pendingInstall = event; installButton.hidden = false;
  };
  const installed = () => { pendingInstall = null; installButton.hidden = true; };
  const prompt = async () => {
    const event = pendingInstall;
    if (!event) return;
    installed();
    try { await event.prompt(); } catch { /* The browser may withdraw an install prompt. */ }
  };
  const check = () => {
    if (stopped || reloading || isConnected() || !version) return Promise.resolve(reloading);
    if (checking) return checking;
    checking = (async () => {
      try {
        const response = await fetch('/api/client-version', { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(5000) });
        if (!response.ok) return false;
        const next = await response.json();
        if (stopped || isConnected() || typeof next.version !== 'string' || !next.version || next.version === version) return false;
        reloading = true; reload(); return true;
      } catch { return false; }
      finally { checking = null; }
    })();
    return checking;
  };
  window.addEventListener('beforeinstallprompt', install);
  window.addEventListener('appinstalled', installed);
  installButton.addEventListener('click', prompt);
  const stop = () => {
    stopped = true;
    window.removeEventListener('beforeinstallprompt', install);
    window.removeEventListener('appinstalled', installed);
    installButton.removeEventListener('click', prompt);
    window.removeEventListener('pagehide', stop);
  };
  window.addEventListener('pagehide', stop);
  return { check, stop };
}
