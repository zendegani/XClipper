// Print-preview page for the XClipper PDF export.
//
// Background opens this page in a new tab with ?key=<uuid> pointing at
// chrome.storage.session[key] = { html, filenameBase }. We hydrate the body
// with that HTML, wait for images, then call window.print(). The user's
// "Save as PDF" destination in the print dialog produces the file; the tab
// self-closes on afterprint.
//
// Why this exists: jsPDF / html2canvas pipelines (raster or vector) all
// produce inferior output to letting Chrome's own print engine render the
// HTML we already render correctly for screenshots. ADR 0001 wants
// selectable text, clickable links, embedded images, unicode — print
// inherits all of that from the browser for free.

const STORAGE_PREFIX = 'xclipper_print_';
const IMAGE_LOAD_TIMEOUT_MS = 5000;

const pLog = (...args: unknown[]): void => console.log('[xclipper print]', ...args);

interface PrintPayload {
  html: string;
  filenameBase: string;
}

async function main(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const key = params.get('key');
  if (!key) {
    showError('Missing print key in URL');
    return;
  }
  const storageKey = STORAGE_PREFIX + key;
  const stored = await chrome.storage.session.get(storageKey);
  const payload = stored[storageKey] as PrintPayload | undefined;
  if (!payload?.html) {
    showError('Print payload not found (expired?)');
    return;
  }
  pLog('payload received, html length =', payload.html.length);

  // Set the tab title — Chrome's "Save as PDF" defaults the filename to the
  // document title, so this is how we control the suggested filename.
  document.title = payload.filenameBase;

  // renderPdfFragment escapes every user-derived value via escapeHtml/
  // escapeAttr (see src/ast/render-pdf-html.ts), so this DOM injection is
  // safe from tweet-content XSS. The print page is extension-origin and
  // not reachable from the web.
  document.body.innerHTML = payload.html;

  // Drop <img> tags with empty or non-http(s) src so they don't burn the
  // image-wait budget (some never fire load or error).
  for (const img of Array.from(document.querySelectorAll('img'))) {
    const src = img.getAttribute('src') || '';
    if (!/^https?:\/\//.test(src)) img.remove();
  }

  await waitForImages(document.body);
  pLog('images settled, invoking print');

  // Drop the storage payload so it doesn't linger if the user cancels.
  void chrome.storage.session.remove(storageKey);

  // Close after the user finishes (or cancels) the print dialog. Some
  // browsers fire afterprint synchronously, some on the next tick — either
  // way one call is enough.
  window.addEventListener('afterprint', () => {
    pLog('afterprint — closing tab');
    window.close();
  });

  // print() is synchronous in Chrome — execution resumes after the dialog
  // is dismissed.
  window.print();
}

function showError(message: string): void {
  document.body.innerHTML =
    `<div style="font:14px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;` +
    `color:#b91c1c;padding:40px;text-align:center">XClipper print error: ${escapeHtml(message)}</div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' :
    c === '<' ? '&lt;' :
    c === '>' ? '&gt;' :
    c === '"' ? '&quot;' : '&#39;',
  );
}

function waitForImages(root: HTMLElement): Promise<void> {
  const imgs = Array.from(root.querySelectorAll('img'));
  if (imgs.length === 0) return Promise.resolve();
  pLog(`waiting for ${imgs.length} image(s)…`);
  return Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) { resolve(); return; }
          const done = (): void => { clearTimeout(t); resolve(); };
          const t = setTimeout(done, IMAGE_LOAD_TIMEOUT_MS);
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', done, { once: true });
        }),
    ),
  ).then(() => undefined);
}

main().catch((err) => {
  showError(err instanceof Error ? err.message : String(err));
});
