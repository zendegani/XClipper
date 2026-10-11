// The one chrome.runtime.onMessage listener of the background. Each action has
// a row: the senders it trusts and its handler. The router checks the sender
// before the handler runs, so a new action cannot skip the check, and the
// type does not accept a row with an empty trust list.

import type { MessageRequest } from '../types/messages';
import { isExtensionPageSender, isTrustedXContentSender } from './security';

// 'extension-page': the popup or another page of this extension.
// 'x-content': this extension's content script on https://x.com.
export type Trust = 'extension-page' | 'x-content';

type Action = MessageRequest['action'];

export interface Route<M> {
  trust: readonly [Trust, ...Trust[]];
  // The return value is the response; undefined sends none. A promise keeps
  // the channel open until it resolves.
  handle: (msg: M, sender: chrome.runtime.MessageSender) => unknown;
}

// The key types the handler's message, so a handler cannot take the request
// type of another action.
export type Routes = { [A in Action]?: Route<Extract<MessageRequest, { action: A }>> };

function isTrusted(sender: chrome.runtime.MessageSender, trust: readonly Trust[]): boolean {
  return trust.some((t) =>
    t === 'extension-page'
      ? isExtensionPageSender(sender, chrome.runtime.id)
      : isTrustedXContentSender(sender)
  );
}

// Returns true when the response is async, as onMessage requires. An unknown
// action or an untrusted sender gets no response.
export function dispatch(
  routes: Routes,
  msg: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void
): boolean {
  const action = (msg as { action?: unknown } | null)?.action;
  if (typeof action !== 'string' || !Object.hasOwn(routes, action)) return false;
  // msg comes from the runtime: only its action is known to match the key.
  const route = routes[action as Action] as Route<unknown>;
  if (!isTrusted(sender, route.trust)) return false;

  const result = route.handle(msg, sender);
  if (result instanceof Promise) {
    void result.then(sendResponse);
    return true;
  }
  if (result !== undefined) sendResponse(result);
  return false;
}

export function listen(routes: Routes): void {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) =>
    dispatch(routes, msg, sender, sendResponse)
  );
}
