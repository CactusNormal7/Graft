/** Last segment of a file path. Splits on both `/` and `\` so Windows paths
 *  (a shipping target) display correctly, not just POSIX ones. */
export function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}
