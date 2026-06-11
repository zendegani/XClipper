import type { PollNode, PollChoice } from '../../ast/types';

export function extractPoll(article: Element): PollNode | undefined {
  const pollEl = article.querySelector('[data-testid="cardPoll"]');
  if (!pollEl) return undefined;

  const choices: PollChoice[] = [];
  for (const choice of pollEl.querySelectorAll('li[role="listitem"], [role="radio"]')) {
    let percent: number | undefined;
    for (const el of choice.querySelectorAll('span, div')) {
      const t = (el.textContent || '').trim();
      const m = t.match(/^(\d+(?:\.\d+)?)%$/);
      if (m) {
        percent = Number(m[1]);
        break;
      }
    }
    let label = (choice.textContent || '').replace(/\s+/g, ' ').trim();
    if (percent !== undefined && label.endsWith(`${percent}%`)) {
      label = label.slice(0, label.length - `${percent}%`.length).trim();
    }
    if (!label) continue;
    choices.push(percent === undefined ? { label } : { label, percent });
  }
  if (choices.length === 0) return undefined;

  // Footer: drop the choices and the radiogroup's notice, then read remaining
  // text — typically "N votes · <status>".
  const clone = pollEl.cloneNode(true) as Element;
  clone.querySelectorAll('ul, [role="radiogroup"]').forEach((el) => el.remove());
  const noticeId = pollEl.querySelector('[role="radiogroup"]')?.getAttribute('aria-describedby');
  if (noticeId) clone.querySelector(`[id="${noticeId}"]`)?.remove();
  const footer = (clone.textContent || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*·\s*/g, ' · ')
    .trim();

  return footer ? { type: 'poll', choices, footer } : { type: 'poll', choices };
}
