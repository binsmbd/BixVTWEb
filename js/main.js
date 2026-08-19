/* Bix Transform — entry point. */
import { App } from './ui/app.js';

function boot() {
  try {
    window.bixApp = new App();
  } catch (err) {
    console.error(err);
    document.body.insertAdjacentHTML('afterbegin',
      `<pre style="padding:16px;color:#ff8a70;font:12px ui-monospace,monospace">Bix Transform failed to start:\n${err.stack || err}</pre>`);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
