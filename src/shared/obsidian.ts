// Normalize a user-entered vault subfolder: backslashes → forward slashes,
// strip empty / `.` / `..` segments to block traversal, collapse repeated
// slashes, drop leading and trailing slashes. Returns "" for unusable input.
function sanitizeVaultFolder(folder: string): string {
  return folder
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
}

// Build an `obsidian://new` deeplink. The note body never goes in the URL:
// the caller copies it to the clipboard and the `clipboard` flag tells
// Obsidian to read it from there (issue #181). A body in the URL silently
// fails on Windows past its ~32k command-line limit, and Obsidian's "Vault not
// found" dialog prints the whole URL, burying the OK button.
// Each value uses `encodeURIComponent` (percent-encoding) rather than
// URLSearchParams form-encoding — the `obsidian://` URI handler treats `+` as
// a literal plus sign.
export function buildObsidianUrl(filename: string, vault: string, folder = ''): string {
  const fileNoExt = filename.replace(/\.md$/, '');
  const cleanFolder = sanitizeVaultFolder(folder);
  const filePath = cleanFolder ? `${cleanFolder}/${fileNoExt}` : fileNoExt;
  const parts: string[] = [];
  if (vault) parts.push(`vault=${encodeURIComponent(vault)}`);
  parts.push(`file=${encodeURIComponent(filePath)}`);
  parts.push('clipboard');
  return `obsidian://new?${parts.join('&')}`;
}
