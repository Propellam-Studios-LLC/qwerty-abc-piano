/** Resolves a CSS selector string or Element reference to an Element, or null. */
export function resolveTarget(target: string | Element | null | undefined): Element | null {
  if (!target) return null;
  if (typeof target === 'string') return document.querySelector(target);
  return target;
}
