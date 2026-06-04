# Privacy Policy — tweet2md

**Last updated:** June 4, 2026

## Summary

tweet2md does **not** collect, store externally, or transmit any user data. Everything happens locally on your device.

## What this extension does

tweet2md accesses the visible content of supported X.com status pages only after the user explicitly requests an action — by clicking the toolbar icon, by clicking the inline download button on a tweet, or by selecting one of the **Save tweet as Markdown**, **Copy tweet as Markdown**, or **Add tweet to Obsidian** items in the right-click menu. It converts the visible page content (tweet, thread, or article text) into Markdown, which can be copied to your clipboard, saved to your local Downloads folder using Chrome's built-in download API, or handed off to the Obsidian desktop app via the `obsidian://new` URI scheme.

## Data collection

- **No personal data is collected.**
- The extension accesses website content (text and images on supported X.com pages) solely to convert it into Markdown and image files at your request.
- **No browsing history is tracked.**
- **No analytics or telemetry is sent.**
- **No data is transmitted to any external server.**
- **No cookies are set or read.**
- **No user accounts or authentication is required.**

## Data processing

All data processing happens **entirely within your browser**:

1. The content script reads the DOM of the current X.com page
2. The page content is converted to Markdown format in-memory
3. The resulting Markdown is either copied to your clipboard or saved as a local file via `chrome.downloads`

No data leaves your browser at any point during this process. The extension does not store extracted content after the operation completes.

When **Save images locally** is enabled, tweet2md only downloads image assets from expected X media hosts such as `pbs.twimg.com`, `video.twimg.com`, `abs.twimg.com`, and `abs-0.twimg.com`. Other external image URLs are not downloaded by the background worker.

### Add to Obsidian

When you click **Add to Obsidian**, the extension builds an `obsidian://new?...` deeplink containing the rendered Markdown (and the optional vault name you configured in Settings) and navigates the popup window to that URL. Your operating system's URL handler then hands the data to the Obsidian desktop app, if installed. The handoff happens **locally on your device** — no network request is made and no external server is involved. Images remain as remote `pbs.twimg.com` URLs in the rendered Markdown so they display inline in Obsidian without writing copies to disk.

### Download .pdf

When you click **Download .pdf**, the extension opens a new tab at an extension-owned `chrome-extension://<id>/print.html` page, hydrates that page with the rendered tweet / thread / article HTML, and calls `window.print()`. Your browser's native print dialog then renders the document and writes it to the destination you choose (typically **Save as PDF**). Rendering happens **entirely in your browser** — no network request is made, no third-party PDF service is involved. The print tab self-closes once the dialog is dismissed.

## Permissions explained

| Permission     | Purpose                                              |
|----------------|------------------------------------------------------|
| `activeTab`    | Allows reading the current tab's page content when you click the extension icon |
| `downloads`    | Allows saving the generated Markdown file and allowed X media images to your Downloads folder |
| `storage`      | Allows saving your popup configuration locally on your device so settings are remembered between sessions. This covers every choice you make in the popup or Settings view — UI toggle states, any text or template fields you fill in, and per-field selections from the Frontmatter picker. All values stay on your device; nothing is transmitted. |
| `contextMenus` | Adds the **Save tweet as Markdown** and **Copy tweet as Markdown** items to the browser's right-click menu, scoped to X.com pages. The menu only fires when you click an item; no page content is read otherwise. |
| `host` (X.com) | A content script is injected on X.com pages to (a) extract the visible post or article content when you trigger an action, and (b) draw the inline download button on tweet action bars. The script reads the DOM locally and never transmits data externally. |

These are the minimum permissions required for the extension to function. No additional permissions are requested.

### Entry points and download safety

The inline download button and right-click context menu are convenience triggers — they perform the **same local extraction** as the popup. They do not collect, transmit, or store anything beyond what the popup already does. When you activate one of them, tweet2md opens the tweet's permalink in a new tab (or runs in the current one if you're already on it), runs the extractor, then saves to Downloads or copies to your clipboard, all inside your browser.

The background worker validates download messages before using privileged browser APIs. Requests must come from a trusted extension page or a supported X.com content script, and filenames are sanitized before they are passed to Chrome's download API.

## Third-party services

tweet2md does not use any third-party services, APIs, or analytics platforms.

## Changes to this policy

If this privacy policy changes, the updated version will be published in this repository and the Chrome Web Store listing will be updated accordingly.

## Contact

If you have questions about this privacy policy, please open an issue on the [GitHub repository](https://github.com/zendegani/tweet2md).
