/**
 * jsdom bootstrap for client boot tests.
 *
 * main.ts is written for the browser (it touches document/localStorage/history and imports the
 * stylesheet), so a boot test has to provide those globals *before* importing it. The CSS import is
 * answered by the resolve hook below: Node would otherwise fail on a `.css` specifier.
 */
import { register } from 'node:module';
import { JSDOM } from 'jsdom';

register(new URL('./css-stub.mjs', import.meta.url));

export function installDom({ url = 'http://localhost/' } = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url, pretendToBeVisual: true });
  const { window } = dom;

  const globals = {
    window,
    document: window.document,
    navigator: window.navigator,
    location: window.location,
    history: window.history,
    localStorage: window.localStorage,
    sessionStorage: window.sessionStorage,
    HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement,
    HTMLSelectElement: window.HTMLSelectElement,
    HTMLTextAreaElement: window.HTMLTextAreaElement,
    HTMLButtonElement: window.HTMLButtonElement,
    SVGElement: window.SVGElement,
    Event: window.Event,
    Node: window.Node,
    NodeFilter: window.NodeFilter,
    NodeList: window.NodeList,
    DocumentFragment: window.DocumentFragment,
    Text: window.Text,
    Element: window.Element,
    CustomEvent: window.CustomEvent,
    KeyboardEvent: window.KeyboardEvent,
    MouseEvent: window.MouseEvent,
    MutationObserver: window.MutationObserver,
    requestAnimationFrame: (cb) => window.setTimeout(() => cb(Date.now()), 0),
    cancelAnimationFrame: (id) => window.clearTimeout(id),
    getComputedStyle: window.getComputedStyle.bind(window),
    matchMedia: (query) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }),
    CSS: { escape: (value) => String(value).replace(/"/g, '\\"') },
    FormData: window.FormData,
    Blob: window.Blob,
    File: window.File,
    FileReader: window.FileReader,
    XMLHttpRequest: window.XMLHttpRequest,
    alert: () => {},
    confirm: () => false,
    prompt: () => null,
  };

  const missing = [];
  for (const [key, value] of Object.entries(globals)) {
    if (value === undefined) missing.push(key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  if (missing.length) throw new Error(`jsdom did not provide: ${missing.join(', ')}`);

  // jsdom has no matchMedia; the files workspace uses it for its mobile layout breakpoint.
  window.matchMedia = globals.matchMedia;

  return { dom, window };
}

/**
 * Route-shaped fetch stub: `handlers` map a URL pattern to a JSON payload.
 *
 * Unhandled URLs answer `{}` and are recorded in `unhandled`, so a boot test does not turn into
 * stub whack-a-mole while still making missing coverage visible.
 */
export function installFetch(handlers, { fallback = {} } = {}) {
  const calls = [];
  const unhandled = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init.method ?? 'GET').toUpperCase();
    calls.push({ url, method, body: init.body });
    // Last match wins, so a test can override a default stub by appending its own.
    const handler = [...handlers].reverse().find((item) => item.match.test(url));
    if (!handler) {
      unhandled.push(`${method} ${url}`);
      return new Response(JSON.stringify(fallback), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const payload = typeof handler.respond === 'function' ? handler.respond(url, init) : handler.respond;
    const status = handler.status ?? 200;
    const body = payload === undefined || payload === null ? '' : JSON.stringify(payload);
    return new Response(body, { status, headers: { 'content-type': 'application/json' } });
  };
  return { calls, unhandled };
}
