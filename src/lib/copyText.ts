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

/**
 * Copy text that isn't ready yet — a summary still being fetched.
 *
 * Safari only lets a page write to the clipboard inside the tap that asked for
 * it, and a network round trip in between is enough for it to refuse. So where
 * the browser allows, the write is started straight away with a ClipboardItem
 * that's handed the promise, and it fills in when the text arrives. Anywhere
 * else it waits for the text and copies as usual.
 *
 * Call it synchronously from the tap handler. If `text` rejects, nothing is
 * copied and this resolves false.
 */
export async function copyTextWhenReady(text: Promise<string>): Promise<boolean> {
  if (
    typeof ClipboardItem !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    navigator.clipboard?.write
  ) {
    try {
      const blob = text.then((t) => new Blob([t], { type: 'text/plain' }));
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
      return true;
    } catch {
      // Refused, or the text never came — fall through.
    }
  }
  try {
    return await copyText(await text);
  } catch {
    return false;
  }
}
