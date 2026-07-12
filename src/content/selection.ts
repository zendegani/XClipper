// Selection mode (ADR 0002, Phase C). Toggled from the popup on any timeline:
// overlay a check mark on each tweet cell and a floating bar with the count +
// Export. Selection is keyed by permalink, so it survives X's cell
// virtualization; checks are re-painted by decorateSelection() (called from the
// injector's mutation observer) as cells re-mount.

import { getStatusUrl } from './status-url';

const SELECT_MARK_ATTR = 'data-xclipper-select';
const SELECTED_ATTR = 'data-xclipper-selected';
const ACCENT = 'rgb(14,165,233)';

let selectionMode = false;
const selectedUrls = new Set<string>();
let selectionBar: HTMLElement | null = null;
let selectionCountEl: HTMLElement | null = null;

function syncMark(mark: HTMLElement, selected: boolean): void {
  mark.textContent = selected ? '✓' : '';
  mark.style.background = selected ? ACCENT : 'rgba(15,20,25,0.55)';
  mark.style.borderColor = selected ? ACCENT : '#fff';
}

export function decorateSelection(): void {
  if (!selectionMode) return;
  for (const article of document.querySelectorAll('article[role="article"]')) {
    const url = getStatusUrl(article);
    if (!url) continue;
    let mark = article.querySelector(`[${SELECT_MARK_ATTR}]`) as HTMLElement | null;
    if (!mark) {
      const host = article as HTMLElement;
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      mark = document.createElement('div');
      mark.setAttribute(SELECT_MARK_ATTR, '1');
      mark.style.cssText = [
        'position:absolute',
        'top:10px',
        'right:10px',
        'width:22px',
        'height:22px',
        'border-radius:9999px',
        'border:2px solid #fff',
        'box-shadow:0 1px 4px rgba(0,0,0,0.4)',
        'color:#fff',
        'font:700 14px/18px system-ui,sans-serif',
        'text-align:center',
        'cursor:pointer',
        'z-index:10',
        'user-select:none',
      ].join(';');
      mark.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const fresh = getStatusUrl(article) || url;
        if (selectedUrls.has(fresh)) {
          selectedUrls.delete(fresh);
          article.removeAttribute(SELECTED_ATTR);
        } else {
          selectedUrls.add(fresh);
          article.setAttribute(SELECTED_ATTR, '1');
        }
        syncMark(mark as HTMLElement, selectedUrls.has(fresh));
        updateSelectionBar();
      });
      article.appendChild(mark);
    }
    // Cells get recycled by the virtualizer — re-sync visuals from state.
    const isSelected = selectedUrls.has(url);
    syncMark(mark, isSelected);
    if (isSelected) article.setAttribute(SELECTED_ATTR, '1');
    else article.removeAttribute(SELECTED_ATTR);
  }
}

function updateSelectionBar(): void {
  if (!selectionCountEl) return;
  // Lead with an instruction so it's obvious what mode this is; switch to the
  // running count once the user starts picking tweets.
  selectionCountEl.textContent =
    selectedUrls.size === 0
      ? chrome.i18n.getMessage('batch_bar_hint') || 'Tap tweets to select'
      : `${selectedUrls.size} ${chrome.i18n.getMessage('batch_bar_selected') || 'selected'}`;
}

function barButton(label: string, solid: boolean, onClick: () => void): HTMLElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.style.cssText = [
    'font:600 14px/1 system-ui,sans-serif',
    'padding:10px 18px',
    'border-radius:10px',
    'cursor:pointer',
    'white-space:nowrap',
    solid ? `background:${ACCENT};border:1px solid ${ACCENT};color:#fff`
          : 'background:transparent;border:1px solid rgba(255,255,255,0.5);color:#fff',
  ].join(';');
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

export function enterSelection(): void {
  if (selectionMode) return;
  selectionMode = true;

  selectionBar = document.createElement('div');
  selectionBar.style.cssText = [
    'position:fixed',
    'bottom:28px',
    'left:50%',
    // Size to content (and cap to the viewport) so the centered bar never
    // wraps to two lines — a fixed box at left:50% otherwise shrink-fits to
    // only half the viewport width.
    'width:max-content',
    'max-width:calc(100vw - 24px)',
    // Start a touch lower and transparent so the bar slides up into view
    // (revealed via requestAnimationFrame below) instead of appearing
    // silently where a scrolling user wouldn't notice it.
    'transform:translateX(-50%) translateY(16px)',
    'opacity:0',
    'transition:opacity .22s ease, transform .22s ease',
    'display:flex',
    'align-items:center',
    'gap:14px',
    'background:rgba(15,20,25,0.97)',
    'color:#fff',
    'padding:14px 20px',
    'border-radius:14px',
    // Accent ring + deep shadow so it stands clear of the timeline.
    `box-shadow:0 8px 28px rgba(0,0,0,0.45), 0 0 0 1px ${ACCENT}`,
    'z-index:2147483647',
    'font:600 15px/1.2 system-ui,sans-serif',
  ].join(';');

  selectionCountEl = document.createElement('span');
  selectionBar.appendChild(selectionCountEl);
  selectionBar.appendChild(
    barButton(chrome.i18n.getMessage('batch_bar_export') || 'Export', true, () => {
      if (selectedUrls.size === 0) return;
      try {
        chrome.runtime.sendMessage(
          { action: 'BATCH_START', urls: Array.from(selectedUrls), origin: 'selection' },
          (resp) => {
            void chrome.runtime.lastError;
            if (resp?.success) {
              if (selectionCountEl) {
                selectionCountEl.textContent =
                  chrome.i18n.getMessage('batch_started') || 'Batch started';
              }
              setTimeout(exitSelection, 1200);
            } else if (selectionCountEl) {
              selectionCountEl.textContent = resp?.error || 'Could not start the batch.';
            }
          }
        );
      } catch {
        /* extension context gone */
      }
    })
  );
  selectionBar.appendChild(barButton('✕', false, exitSelection));
  document.body.appendChild(selectionBar);

  updateSelectionBar();
  decorateSelection();

  // Next frame: animate from the hidden initial state into view.
  requestAnimationFrame(() => {
    if (!selectionBar) return;
    selectionBar.style.opacity = '1';
    selectionBar.style.transform = 'translateX(-50%) translateY(0)';
  });
}

export function exitSelection(): void {
  selectionMode = false;
  selectedUrls.clear();
  document.querySelectorAll(`[${SELECT_MARK_ATTR}]`).forEach((m) => m.remove());
  document.querySelectorAll(`[${SELECTED_ATTR}]`).forEach((a) => a.removeAttribute(SELECTED_ATTR));
  selectionBar?.remove();
  selectionBar = null;
  selectionCountEl = null;
}
