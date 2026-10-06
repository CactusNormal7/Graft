/** Fire-and-forget copy to the system clipboard (no-op if unavailable). */
export function copyToClipboard(text: string): void {
  void navigator.clipboard?.writeText(text);
}
