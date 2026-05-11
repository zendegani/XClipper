const ALLOWED_IMAGE_HOSTS = new Set([
  'pbs.twimg.com',
  'video.twimg.com',
  'abs.twimg.com',
  'abs-0.twimg.com',
]);

const DEFAULT_DOWNLOAD_FILENAME = 'tweet2md.md';
const MAX_PATH_SEGMENT_LENGTH = 80;
const MAX_DOWNLOAD_PATH_LENGTH = 200;

function parseUrl(raw: string | undefined): URL | null {
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function isHttpsXUrl(raw: string | undefined): boolean {
  const url = parseUrl(raw);
  return url?.protocol === 'https:' && url.hostname === 'x.com';
}

function isExtensionPageSender(
  sender: chrome.runtime.MessageSender,
  extensionId: string
): boolean {
  if (!extensionId || sender.id !== extensionId) return false;

  const candidates = [sender.url, sender.origin];

  return candidates.some((candidate) => {
    const url = parseUrl(candidate);
    return url?.protocol === 'chrome-extension:' && url.hostname === extensionId;
  });
}

export function isTrustedXContentSender(
  sender: chrome.runtime.MessageSender
): boolean {
  if (isHttpsXUrl(sender.url)) return true;

  const senderUrl = parseUrl(sender.url);
  if (!senderUrl || senderUrl.protocol === 'about:') {
    if (isHttpsXUrl(sender.origin)) return true;
  }

  return !sender.url && !sender.origin && isHttpsXUrl(sender.tab?.url);
}

export function isTrustedDownloadSender(
  sender: chrome.runtime.MessageSender,
  extensionId: string
): boolean {
  return isTrustedXContentSender(sender) || isExtensionPageSender(sender, extensionId);
}

export function isAllowedImageUrl(raw: string): boolean {
  const url = parseUrl(raw);
  return !!url && url.protocol === 'https:' && ALLOWED_IMAGE_HOSTS.has(url.hostname);
}

function sanitizePathSegment(segment: string): string {
  return segment
    .replace(/[<>:"|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .slice(0, MAX_PATH_SEGMENT_LENGTH);
}

function truncatePathPreservingExtension(path: string): string {
  if (path.length <= MAX_DOWNLOAD_PATH_LENGTH) return path;

  const lastSlash = path.lastIndexOf('/');
  const finalSegment = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
  const lastDot = finalSegment.lastIndexOf('.');
  const hasExtension = lastDot > 0 && lastDot < finalSegment.length - 1;

  if (hasExtension) {
    const extension = finalSegment.slice(lastDot);
    if (extension.length < MAX_DOWNLOAD_PATH_LENGTH) {
      return path
        .slice(0, MAX_DOWNLOAD_PATH_LENGTH - extension.length)
        .replace(/\/+$/g, '') + extension;
    }
  }

  return path.slice(0, MAX_DOWNLOAD_PATH_LENGTH).replace(/\/+$/g, '');
}

export function sanitizeFilePath(name: string): string {
  const sanitized = String(name ?? '')
    .normalize('NFKC')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .map(sanitizePathSegment)
    .filter(Boolean)
    .join('/')
    .replace(/^\/+/, '');

  if (!sanitized) return DEFAULT_DOWNLOAD_FILENAME;

  return truncatePathPreservingExtension(sanitized) || DEFAULT_DOWNLOAD_FILENAME;
}
