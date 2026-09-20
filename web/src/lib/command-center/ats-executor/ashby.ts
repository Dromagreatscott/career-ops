import { BrowserAtsAdapter } from "./browser-adapter";

/**
 * Ashby executor adapter.
 *
 * Ashby renders clean, standards-based application forms (react-select combobox
 * widgets, native file inputs) that the shared apply/session browser stack already
 * extracts and fills reliably — the same stack Greenhouse and Lever ride on. So
 * the full AtsExecutionAdapter contract (inspectApplication, mapFields, fillFields,
 * uploadResume, validate, submit, captureConfirmation) is inherited from
 * BrowserAtsAdapter; only host detection is Ashby-specific.
 */
export class AshbyAdapter extends BrowserAtsAdapter {
  readonly type = "ashby" as const;

  detect(url: URL): boolean {
    const host = url.hostname.toLowerCase();
    // Canonical hosted board: jobs.ashbyhq.com/{company}/{job-uuid}
    if (host === "jobs.ashbyhq.com") return /^\/[^/]+\/[^/?#]+/.test(url.pathname);
    // Company-scoped subdomains and the bare apex.
    if (host === "ashbyhq.com" || host.endsWith(".ashbyhq.com")) return /\/[^/?#]+/.test(url.pathname);
    // Defensive: any host that still advertises ashby with a usable path.
    return /\bashby(hq)?\b/i.test(host) && /\/[^/?#]+/.test(url.pathname);
  }
}
