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

// Build an `obsidian://new` deeplink. Each value uses `encodeURIComponent`
// (percent-encoding) rather than URLSearchParams form-encoding — the
// `obsidian://` URI handler treats `+` as a literal plus sign, so a
// form-encoded query would dump literal `+` characters all over the
// rendered note's body, frontmatter, and tags.
export function buildObsidianUrl(
  content: string,
  filename: string,
  vault: string,
  folder = ''
): string {
  const fileNoExt = filename.replace(/\.md$/, '');
  const cleanFolder = sanitizeVaultFolder(folder);
  const filePath = cleanFolder ? `${cleanFolder}/${fileNoExt}` : fileNoExt;
  const parts: string[] = [];
  if (vault) parts.push(`vault=${encodeURIComponent(vault)}`);
  parts.push(`file=${encodeURIComponent(filePath)}`);
  parts.push(`content=${encodeURIComponent(content)}`);
  return `obsidian://new?${parts.join('&')}`;
}
