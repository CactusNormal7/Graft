/** Last segment of a file path. Splits on both `/` and `\` so Windows paths
 *  (a shipping target) display correctly, not just POSIX ones. */
export function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/** True for an absolute POSIX (`/…`), Windows drive (`C:\…`, `C:/…`) or UNC
 *  (`\\server\…`) path. */
export function isAbsolutePath(path: string): boolean {
  return /^([\\/]|[A-Za-z]:[\\/])/.test(path);
}

/** Resolve `path` against the directory of `baseFile` when it is relative —
 *  how a `.graft` file's `dbPath` is read (same rule as `graft-mcp`). The
 *  separator of `baseFile` is reused so Windows paths stay Windows paths. */
export function resolveFrom(baseFile: string, path: string): string {
  if (isAbsolutePath(path)) return path;
  const cut = Math.max(baseFile.lastIndexOf("/"), baseFile.lastIndexOf("\\"));
  if (cut < 0) return path;
  return baseFile.slice(0, cut + 1) + path;
}
