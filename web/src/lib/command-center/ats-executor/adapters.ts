import type { AtsType } from "../types";
import type { AtsExecutionAdapter } from "./types";
import { GreenhouseAdapter } from "./greenhouse";
import { LeverAdapter } from "./lever";

export type FutureAtsType = Extract<AtsType, "ashby" | "workday" | "unknown">;

export const ATS_EXECUTION_ADAPTERS: AtsExecutionAdapter[] = [
  new GreenhouseAdapter(),
  new LeverAdapter(),
];

export function detectExecutionAts(url: URL): AtsType {
  return ATS_EXECUTION_ADAPTERS.find((adapter) => adapter.detect(url))?.type ?? "unknown";
}

export function adapterForUrl(url: URL): AtsExecutionAdapter | null {
  return ATS_EXECUTION_ADAPTERS.find((adapter) => adapter.detect(url)) ?? null;
}

export function adapterForAts(type: AtsType): AtsExecutionAdapter | null {
  return ATS_EXECUTION_ADAPTERS.find((adapter) => adapter.type === type) ?? null;
}
