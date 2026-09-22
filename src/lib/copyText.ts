// Put text on the clipboard, on the phones this app actually runs on.
//
// navigator.clipboard is the right answer and the only one worth reaching for
// first, but it isn't there on an insecure origin and older WebKit refuses it
// outside a user gesture it recognises. The fallback below is the long-standing
// iOS workaround: a textarea off-screen, made editable so iOS will let a range
// be selected inside it, selected through a Range because setSelectionRange
// alone doesn't take there, then copied and removed.
//
// It's more machinery than a copy button deserves, and it's here because the
// person most likely to press it is the one whose browser is oldest.

/** True if the text made it to the clipboard. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Refused — fall through and try the old way.
  }

  if (typeof document === 'undefined') return false;
  const area = document.createElement('textarea');
  area.value = text;
  area.contentEditable = 'true';
  area.readOnly = false;
  // Off-screen rather than hidden: a display:none element can't be selected,
  // and scrolling the page to a focused input would jump the view.
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.left = '0';
  area.style.width = '1px';
  area.style.height = '1px';
  area.style.padding = '0';
  area.style.border = 'none';
  area.style.opacity = '0';
  document.body.appendChild(area);

  try {
    const range = document.createRange();
    range.selectNodeContents(area);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    area.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(area);
  }
}
