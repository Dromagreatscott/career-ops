import { BrowserAtsAdapter } from "./browser-adapter";

export class LeverAdapter extends BrowserAtsAdapter {
  readonly type = "lever" as const;

  detect(url: URL): boolean {
    const host = url.hostname.toLowerCase();
    if (host === "jobs.lever.co" || host === "jobs.eu.lever.co") return /^\/[^/]+\/[^/?#]+/.test(url.pathname);
    if (host === "lever.co" || host.endsWith(".lever.co")) return /\/[^/]+\/[^/?#]+/.test(url.pathname);
    return /\blever\b/i.test(host) && /\/[^/]+\/[^/?#]+/.test(url.pathname);
  }
}
