// Build an `obsidian://new` deeplink. Each value uses `encodeURIComponent`
// (percent-encoding) rather than URLSearchParams form-encoding — the
// `obsidian://` URI handler treats `+` as a literal plus sign, so a
// form-encoded query would dump literal `+` characters all over the
// rendered note's body, frontmatter, and tags.
export function buildObsidianUrl(
  content: string,
  filename: string,
  vault: string
): string {
  const fileNoExt = filename.replace(/\.md$/, '');
  const parts: string[] = [];
  if (vault) parts.push(`vault=${encodeURIComponent(vault)}`);
  parts.push(`file=${encodeURIComponent(fileNoExt)}`);
  parts.push(`content=${encodeURIComponent(content)}`);
  return `obsidian://new?${parts.join('&')}`;
}
