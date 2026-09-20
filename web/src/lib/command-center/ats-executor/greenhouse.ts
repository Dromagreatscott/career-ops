import { BrowserAtsAdapter } from "./browser-adapter";

export class GreenhouseAdapter extends BrowserAtsAdapter {
  readonly type = "greenhouse" as const;

  detect(url: URL): boolean {
    const host = url.hostname.toLowerCase();
    if (host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io") return /^\/[^/]+\/jobs\/[^/?#]+/.test(url.pathname);
    if (host === "greenhouse.io" || host.endsWith(".greenhouse.io")) return /\/jobs?\/[^/?#]+/.test(url.pathname) || /\/embed\/job_app/.test(url.pathname);
    return /\bgreenhouse\b/i.test(host) && /\/jobs?\/[^/?#]+/.test(url.pathname);
  }
}
