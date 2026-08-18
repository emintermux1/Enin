import { sanitizeText } from "@viceblock/shared";

export function plainClipboardText(event: ClipboardEvent): string {
  const plain = event.clipboardData?.getData("text/plain") ?? "";
  return sanitizeText(plain, 40);
}

export function blockRichPaste(event: ClipboardEvent): void {
  event.preventDefault();
  const text = plainClipboardText(event);
  const el = event.target;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    el.value = sanitizeText(el.value.slice(0, start) + text + el.value.slice(end), 24);
  }
}
