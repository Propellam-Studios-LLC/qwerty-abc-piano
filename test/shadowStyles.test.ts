import { describe, it, expect, beforeEach } from 'vitest';
import { mountFullUI } from '../src/ui/mountFullUI.js';
import { injectStylesInto } from '../src/domStyles.js';

// When the widget is mounted inside a shadow root (Flutter web's CanvasKit
// renderer, for example, places platform views in one), stylesheets appended
// to document.head do not apply. The injector must place the <style> inside
// the shadow root that contains the mount element.

function freshDom(): void {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
}

describe('injectStylesInto (shadow-DOM-aware)', () => {
  beforeEach(freshDom);

  it('appends to document.head for light-DOM elements', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    injectStylesInto(div, 'test-styles-light', '.a { color: red; }');
    expect(document.getElementById('test-styles-light')).not.toBeNull();
  });

  it('appends inside the shadow root for shadow-DOM elements', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const div = document.createElement('div');
    shadow.appendChild(div);

    injectStylesInto(div, 'test-styles-shadow', '.a { color: red; }');

    expect(shadow.querySelector('style#test-styles-shadow')).not.toBeNull();
    expect(document.getElementById('test-styles-shadow')).toBeNull();
  });

  it('dedupes per root, not globally', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const div = document.createElement('div');
    shadow.appendChild(div);

    injectStylesInto(div, 'test-styles-dupe', '.a {}');
    injectStylesInto(div, 'test-styles-dupe', '.a {}');
    expect(shadow.querySelectorAll('style#test-styles-dupe').length).toBe(1);

    // A light-DOM injection with the same id still gets its own copy.
    const lightDiv = document.createElement('div');
    document.body.appendChild(lightDiv);
    injectStylesInto(lightDiv, 'test-styles-dupe', '.a {}');
    expect(document.getElementById('test-styles-dupe')).not.toBeNull();
  });
});

describe('mountFullUI styles inside a shadow root', () => {
  beforeEach(freshDom);

  it('injects both the full-UI and lib stylesheets into the shadow root', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const container = document.createElement('div');
    shadow.appendChild(container);

    mountFullUI(container, { autoBarline: false });

    const fullUi = shadow.querySelector('style#qap-full-ui-styles');
    expect(fullUi).not.toBeNull();
    expect(fullUi!.textContent).toContain('.qap-notation-wrap');
    expect(shadow.querySelector('style#qwerty-abc-piano-lib-styles')).not.toBeNull();
  });

  it('still injects into document.head for a light-DOM mount', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    mountFullUI(container, { autoBarline: false });

    expect(document.getElementById('qap-full-ui-styles')).not.toBeNull();
    expect(document.getElementById('qwerty-abc-piano-lib-styles')).not.toBeNull();
  });
});
