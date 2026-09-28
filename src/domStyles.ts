/**
 * Shadow-DOM-aware style injection: adds a `<style id={id}>` containing `css`
 * to the root node that contains `refEl`, once per root.
 *
 * Embedders can mount the widget inside a shadow root (Flutter web's CanvasKit
 * renderer places platform views in one), where stylesheets in `document.head`
 * do not apply. Injecting into the shadow root when `refEl` is inside one, and
 * into `document.head` otherwise, makes the CSS reach the widget in both
 * cases. Does nothing outside a browser or if the style is already present.
 */
export function injectStylesInto(
  refEl: Element | null | undefined,
  id: string,
  css: string,
): void {
  if (typeof document === 'undefined') return;

  const rootNode = refEl?.getRootNode ? refEl.getRootNode() : document;
  const shadowRoot =
    typeof ShadowRoot !== 'undefined' && rootNode instanceof ShadowRoot
      ? rootNode
      : null;

  // Dedupe per root: each shadow root needs its own copy of the styles.
  const existing = shadowRoot
    ? shadowRoot.querySelector(`style#${id}`)
    : document.getElementById(id);
  if (existing) return;

  const style = document.createElement('style');
  style.id = id;
  style.textContent = css;
  (shadowRoot ?? document.head).appendChild(style);
}
