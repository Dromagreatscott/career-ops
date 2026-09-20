import type { AtsType } from "../types";
import type { AtsExecutionAdapter } from "./types";
import { GreenhouseAdapter } from "./greenhouse";
import { LeverAdapter } from "./lever";
import { AshbyAdapter } from "./ashby";
import { WorkdayAdapter } from "./workday";
import { GenericAtsAdapter } from "./generic";

// The generic fallback adapter MUST stay last: its detect() matches any URL, so a
// first-class adapter (Greenhouse/Lever/Ashby/Workday) always wins when it applies,
// and unknown pages fall through to the generic manual-assist adapter.
export const ATS_EXECUTION_ADAPTERS: AtsExecutionAdapter[] = [
  new GreenhouseAdapter(),
  new LeverAdapter(),
  new AshbyAdapter(),
  new WorkdayAdapter(),
  new GenericAtsAdapter(),
];

/**
 * Report the detected ATS type. A first-class adapter wins when it matches;
 * otherwise the generic fallback (type "unknown") matches, so unknown pages still
 * resolve to "unknown" — detection stays honest even though a working adapter is
 * now available for them.
 */
export function detectExecutionAts(url: URL): AtsType {
  return ATS_EXECUTION_ADAPTERS.find((adapter) => adapter.detect(url))?.type ?? "unknown";
}

/**
 * Resolve the adapter that should drive a URL. A first-class adapter wins when it
 * matches; otherwise the generic manual-assist fallback is returned (never null for
 * a URL that already passed the executor's URL-safety checks).
 */
export function adapterForUrl(url: URL): AtsExecutionAdapter | null {
  return ATS_EXECUTION_ADAPTERS.find((adapter) => adapter.detect(url)) ?? null;
}

export function adapterForAts(type: AtsType): AtsExecutionAdapter | null {
  return ATS_EXECUTION_ADAPTERS.find((adapter) => adapter.type === type) ?? null;
}
