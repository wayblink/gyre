export type FetchStub = {
  match: RegExp;
  respond?: unknown;
  status?: number;
};

export type DomResult = {
  dom: import('jsdom').JSDOM;
  window: import('jsdom').DOMWindow;
};

export declare function installDom(options?: { url?: string }): DomResult;

export declare function installFetch(
  handlers: FetchStub[],
  options?: { fallback?: unknown },
): { calls: Array<{ url: string; method: string; body?: unknown }>; unhandled: string[] };
