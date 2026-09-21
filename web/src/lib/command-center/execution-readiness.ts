import { validateExecutionUrlSyncForTest } from "./executor-url";
import type { ApplicationPackage, AtsType } from "./types";

export type AtsSupport = "SUPPORTED" | "MANUAL_ASSIST" | "UNSUPPORTED";

// Phase 3 executor foundation: Greenhouse / Lever / Ashby / Workday are first-class
// adapters; an unknown ATS is served by the generic manual-assist fallback (inspects
// + fills safe fields, then stops for David) — which is NOT equivalent to full
// first-class support and never live auto-submits.
const FIRST_CLASS: ReadonlySet<AtsType> = new Set<AtsType>(["greenhouse", "lever", "ashby", "workday"]);

export function atsSupport(atsType: AtsType): AtsSupport {
  if (FIRST_CLASS.has(atsType)) return "SUPPORTED";
  if (atsType === "unknown") return "MANUAL_ASSIST";
  return "UNSUPPORTED";
}

export function atsSupportLabel(support: AtsSupport): string {
  return support === "SUPPORTED" ? "SUPPORTED" : support === "MANUAL_ASSIST" ? "MANUAL ASSIST" : "UNSUPPORTED";
}

export type ExecutionReadiness = {
  ats: string;
  atsSupport: AtsSupport;
  url: "VALID" | "INVALID";
  resume: "READY" | "MISSING";
  profile: "READY" | "INCOMPLETE";
  answers: "NEEDS YOU" | "NEEDS REVIEW" | "AUTO-FILL READY";
  approval: "VALID" | "REQUIRED";
  warnings: string[];
  readyForLive: boolean;
};

export function executionReadiness(pkg: ApplicationPackage): ExecutionReadiness {
  const url = validateExecutionUrlSyncForTest(pkg.canonicalApplyUrl ?? pkg.canonicalJobUrl);
  const support = atsSupport(pkg.atsType);
  // Only a first-class adapter may auto-drive a live submission. The generic
  // manual-assist fallback is deliberately excluded from readyForLive so the UI
  // never presents it as equivalent to first-class support.
  const supported = support === "SUPPORTED";
  const userRequired = pkg.questions.filter((question) => question.classification === "USER_REQUIRED");
  const reviewRequired = pkg.questions.filter((question) => question.classification === "REVIEW_REQUIRED");
  const approvalValid = pkg.status === "APPROVED" && pkg.approval?.status === "approved" && pkg.approval.packageHash === pkg.packageHash;
  const warnings = [
    support === "SUPPORTED"
      ? ""
      : support === "MANUAL_ASSIST"
        ? "Unknown ATS — generic manual assist only: Career Ops fills safe fields and stops for you to review and submit."
        : "Unsupported ATS. Use manual mode or wait for a supported adapter.",
    url.ok ? "" : "Application URL is not safe or valid for browser execution.",
    pkg.selectedResume.status === "ready" ? "" : "Selected resume is not ready.",
    userRequired.length ? `${userRequired.length} field(s) still need David.` : "",
    reviewRequired.some((question) => !question.value && question.draft) ? "Review-required drafts should be approved before live submission." : "",
    approvalValid ? "" : "Exact package approval is required for live execution.",
  ].filter(Boolean);
  return {
    ats: atsSupportLabel(support),
    atsSupport: support,
    url: url.ok ? "VALID" : "INVALID",
    resume: pkg.selectedResume.status === "ready" ? "READY" : "MISSING",
    profile: pkg.profileSnapshot ? "READY" : "INCOMPLETE",
    answers: userRequired.length ? "NEEDS YOU" : reviewRequired.length ? "NEEDS REVIEW" : "AUTO-FILL READY",
    approval: approvalValid ? "VALID" : "REQUIRED",
    warnings,
    readyForLive: supported && url.ok && pkg.selectedResume.status === "ready" && !userRequired.length && approvalValid,
  };
}
