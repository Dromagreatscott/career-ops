import { validateExecutionUrl } from "../executor-url";
import {
  createApplicationSession,
  findApplicationSession,
  markIntervention,
  resumeApplicationSession,
  updateApplicationSession,
} from "../application-sessions";
import {
  readApplicationPackage,
  setApplicationPackageExecutionStatus,
} from "../application-packages";
import type {
  ApplicationBlockerCode,
  ApplicationDryRunReport,
  ApplicationPackage,
  ApplicationSession,
  ApplicationSessionAuditEvent,
} from "../types";
import { adapterForUrl, detectExecutionAts } from "./adapters";
import { dryRunReport } from "./field-mapping";
import type { ExecutionBlocker, InspectedApplication } from "./types";

export type ExecuteAction = "dry-run" | "start-live" | "resume" | "status";

export type ExecuteInput = {
  packageId: string;
  packageHash?: string;
  version?: number;
  action: ExecuteAction;
  sessionId?: string;
  fill?: boolean;
};

export type ExecuteOptions = {
  resolveDns?: boolean;
  inspected?: InspectedApplication;
};

export type ExecuteResponse =
  | { ok: true; session: ApplicationSession; report?: ApplicationDryRunReport; blockers?: ExecutionBlocker[] }
  | { ok: false; status: number; error: string; code?: ApplicationBlockerCode };

function audit(type: ApplicationSessionAuditEvent["type"], summary: string, extra: Partial<ApplicationSessionAuditEvent> = {}): ApplicationSessionAuditEvent {
  return { timestamp: new Date().toISOString(), type, summary, ...extra };
}

function stale(status = 409, error = "stale package approval"): ExecuteResponse {
  return { ok: false, status, error, code: "STALE_APPROVAL" };
}

function assertPackageVersion(pkg: ApplicationPackage, hash?: string, version?: number): ExecuteResponse | null {
  if (hash && pkg.packageHash !== hash) return stale(409, "package hash changed after review");
  if (version && pkg.version !== version) return stale(409, "package version changed after review");
  return null;
}

export function assertExactApproval(pkg: ApplicationPackage, hash?: string, version?: number, allowedStatuses: ApplicationPackage["status"][] = ["APPROVED"]): ExecuteResponse | null {
  const versionError = assertPackageVersion(pkg, hash, version);
  if (versionError) return versionError;
  if (!allowedStatuses.includes(pkg.status)) return stale(409, "package is not approved for live execution");
  if (pkg.approval?.status !== "approved") return stale(409, "approved package decision is missing");
  if (pkg.approval.packageHash !== pkg.packageHash) return stale(409, "approval does not match current package hash");
  return null;
}

function firstBlocker(blockers: ExecutionBlocker[]): ExecutionBlocker {
  return blockers[0] ?? {
    code: "UNEXPECTED_ATS_STRUCTURE",
    message: "Execution stopped before the package could be submitted.",
    action: "Review the application session before resuming.",
  };
}

async function createBlockedSession(input: ExecuteInput, pkg: ApplicationPackage, code: ApplicationBlockerCode, message: string, action: string): Promise<ExecuteResponse> {
  const session = createApplicationSession({
    userId: pkg.userId ?? "career-ops-operator",
    profileScope: pkg.profileScope ?? "career-ops",
    applicationPackageId: pkg.id,
    applicationPackageVersion: pkg.version,
    applicationPackageHash: pkg.packageHash,
    atsType: pkg.atsType,
    applicationUrl: pkg.canonicalApplyUrl ?? pkg.canonicalJobUrl,
    canonicalUrl: pkg.canonicalApplyUrl ?? pkg.canonicalJobUrl,
    mode: input.action === "start-live" ? "LIVE" : "DRY_RUN",
  });
  if (!session.ok) return { ok: false, status: session.status, error: session.error, code: session.code };
  const report = dryRunReport(pkg.atsType, [], code === "MISSING_RESUME" ? "MISSING" : "READY", [{ code, message, action }]);
  const updated = markIntervention(session.session.id, code, message, action, report);
  return { ok: true, session: updated ?? session.session, report, blockers: [{ code, message, action }] };
}

async function runSession(pkg: ApplicationPackage, session: ApplicationSession, input: ExecuteInput, options: ExecuteOptions): Promise<ExecuteResponse> {
  const parsed = await validateExecutionUrl(session.canonicalUrl, options.resolveDns ?? true);
  if (!parsed.ok) {
    const blocker = { code: "BAD_APPLICATION_URL" as const, message: "Application URL is not safe for browser execution.", action: "Replace the application URL with a public Greenhouse or Lever URL." };
    const report = dryRunReport(session.atsType, [], "READY", [blocker]);
    const updated = markIntervention(session.id, blocker.code, blocker.message, blocker.action, report);
    return { ok: true, session: updated ?? session, report, blockers: [blocker] };
  }

  const adapter = adapterForUrl(parsed.parsed);
  if (!adapter) {
    const blocker = { code: "UNSUPPORTED_ATS" as const, message: "Career Ops does not support this ATS yet.", action: "Use manual application mode for this job." };
    const report = dryRunReport("unknown", [], "READY", [blocker]);
    const updated = markIntervention(session.id, blocker.code, blocker.message, blocker.action, report);
    return { ok: true, session: updated ?? session, report, blockers: [blocker] };
  }

  updateApplicationSession(session.id, { atsType: adapter.type, lastStep: "ATS_DETECTED" }, audit("ATS_DETECTED", `${adapter.type} detected.`));
  const ctx = { session: { ...session, atsType: adapter.type }, pkg, mode: session.mode, dryRunFill: Boolean(input.fill || session.mode === "LIVE") };
  const inspected = options.inspected ?? await adapter.startSession(ctx);
  updateApplicationSession(session.id, { lastStep: "FORM_INSPECTED" }, audit("FORM_INSPECTED", `${inspected.fields.length} fields inspected.`));
  const mappings = await adapter.mapFields(ctx, inspected);
  updateApplicationSession(session.id, { lastStep: "FIELD_MAPPED" }, audit("FIELD_MAPPED", `${mappings.length} fields mapped.`));
  const resumeBlocker = await adapter.uploadResume(ctx, inspected);
  if (!resumeBlocker) updateApplicationSession(session.id, { lastStep: "RESUME_UPLOADED" }, audit("RESUME_UPLOADED", "Approved resume version verified for upload."));
  const fillBlockers = await adapter.fillFields(ctx, inspected, mappings);
  if (!fillBlockers.length) updateApplicationSession(session.id, { lastStep: "FIELD_FILLED" }, audit("FIELD_FILLED", session.mode === "DRY_RUN" ? "Dry-run fill skipped or completed before submit." : "Approved fields filled before submit."));
  const validationBlockers = await adapter.validate(ctx, inspected, mappings);
  const blockers = [resumeBlocker, ...fillBlockers, ...validationBlockers].filter(Boolean) as ExecutionBlocker[];
  const report = adapter.report ? adapter.report(ctx, mappings, blockers) : dryRunReport(adapter.type, mappings, resumeBlocker ? "MISSING" : "READY", blockers);

  if (session.mode === "DRY_RUN") {
    if (blockers.length) {
      const blocker = firstBlocker(blockers);
      const updated = markIntervention(session.id, blocker.code, blocker.message, blocker.action, report);
      return { ok: true, session: updated ?? session, report, blockers };
    }
    const updated = updateApplicationSession(session.id, {
      status: "DRY_RUN_COMPLETE",
      lastStep: "DRY_RUN_COMPLETED",
      requiresUserAction: false,
      accountState: "APPLICATION_READY",
      dryRunReport: report,
    }, audit("DRY_RUN_COMPLETED", "Dry run reached pre-submit readiness."));
    return { ok: true, session: updated ?? session, report, blockers };
  }

  if (blockers.length) {
    const blocker = firstBlocker(blockers);
    setApplicationPackageExecutionStatus(pkg.id, pkg.packageHash, pkg.version, "USER_INTERVENTION_REQUIRED");
    const updated = markIntervention(session.id, blocker.code, blocker.message, blocker.action, report);
    return { ok: true, session: updated ?? session, report, blockers };
  }

  const reread = readApplicationPackage(pkg.id);
  if (!reread.ok) return { ok: false, status: reread.status, error: reread.error };
  const approvalError = assertExactApproval(reread.package, pkg.packageHash, pkg.version, ["APPROVED", "SUBMITTING"]);
  if (approvalError) {
    const blocker = { code: "STALE_APPROVAL" as const, message: approvalError.error, action: "Rebuild, review, and approve the current package." };
    const staleReport = dryRunReport(adapter.type, mappings, "READY", [blocker]);
    setApplicationPackageExecutionStatus(pkg.id, pkg.packageHash, pkg.version, "USER_INTERVENTION_REQUIRED");
    const updated = markIntervention(session.id, blocker.code, blocker.message, blocker.action, staleReport);
    return { ok: true, session: updated ?? session, report: staleReport, blockers: [blocker] };
  }

  updateApplicationSession(session.id, { lastStep: "SUBMISSION_ATTEMPTED" }, audit("SUBMISSION_ATTEMPTED", "Final submit path reached after exact approval validation."));
  const submitBlocker = await adapter.submit(ctx, inspected);
  if (submitBlocker) {
    const blockedReport = dryRunReport(adapter.type, mappings, "READY", [submitBlocker]);
    setApplicationPackageExecutionStatus(pkg.id, pkg.packageHash, pkg.version, "USER_INTERVENTION_REQUIRED");
    const updated = markIntervention(session.id, submitBlocker.code, submitBlocker.message, submitBlocker.action, blockedReport);
    return { ok: true, session: updated ?? session, report: blockedReport, blockers: [submitBlocker] };
  }
  const confirmation = await adapter.captureConfirmation(ctx, inspected);
  if (!confirmation) {
    const blocker = { code: "CONFIRMATION_UNVERIFIED" as const, message: "Career Ops could not positively verify submission confirmation.", action: "Check the ATS page before retrying or resuming." };
    const unverified = dryRunReport(adapter.type, mappings, "READY", [blocker]);
    setApplicationPackageExecutionStatus(pkg.id, pkg.packageHash, pkg.version, "USER_INTERVENTION_REQUIRED");
    const updated = markIntervention(session.id, blocker.code, blocker.message, blocker.action, unverified);
    return { ok: true, session: updated ?? session, report: unverified, blockers: [blocker] };
  }
  setApplicationPackageExecutionStatus(pkg.id, pkg.packageHash, pkg.version, "SUBMITTED");
  const updated = updateApplicationSession(session.id, {
    status: "SUBMITTED",
    lastStep: "SUBMITTED",
    requiresUserAction: false,
    accountState: "APPLICATION_READY",
    confirmationId: confirmation.id,
    confirmationUrl: confirmation.url,
    confirmationSummary: confirmation.summary,
    submittedAt: new Date().toISOString(),
    dryRunReport: report,
  }, audit("SUBMITTED", confirmation.summary));
  return { ok: true, session: updated ?? session, report, blockers: [], };
}

export async function executeApplicationPackage(input: ExecuteInput, options: ExecuteOptions = {}): Promise<ExecuteResponse> {
  if (input.action === "status") {
    if (!input.sessionId) return { ok: false, status: 400, error: "sessionId is required" };
    const session = findApplicationSession(input.sessionId);
    if (!session || session.applicationPackageId !== input.packageId) return { ok: false, status: 404, error: "execution session not found" };
    return { ok: true, session, report: session.dryRunReport };
  }

  const read = readApplicationPackage(input.packageId);
  if (!read.ok) return { ok: false, status: read.status, error: read.error };
  const pkg = read.package;
  const versionError = assertPackageVersion(pkg, input.packageHash, input.version);
  if (versionError) return versionError;

  if (input.action === "start-live") {
    const approvalError = assertExactApproval(pkg, input.packageHash, input.version);
    if (approvalError) return approvalError;
  }

  if (input.action === "resume") {
    if (!input.sessionId) return { ok: false, status: 400, error: "sessionId is required" };
    const existing = findApplicationSession(input.sessionId);
    if (!existing || existing.applicationPackageId !== pkg.id) return { ok: false, status: 404, error: "execution session not found" };
    if (existing.mode === "LIVE") {
      const approvalError = assertExactApproval(pkg, existing.applicationPackageHash, existing.applicationPackageVersion, ["USER_INTERVENTION_REQUIRED", "SUBMITTING"]);
      if (approvalError) return approvalError;
      const transition = setApplicationPackageExecutionStatus(pkg.id, pkg.packageHash, pkg.version, "SUBMITTING");
      if (!transition.ok) return { ok: false, status: transition.status, error: transition.error };
    }
    const resumed = resumeApplicationSession(existing.id);
    if (!resumed.ok) return { ok: false, status: resumed.status, error: resumed.error };
    return runSession(pkg, resumed.session, { ...input, fill: input.fill ?? existing.mode === "LIVE" }, options);
  }

  const rawUrl = pkg.canonicalApplyUrl ?? pkg.canonicalJobUrl;
  const parsed = await validateExecutionUrl(rawUrl, options.resolveDns ?? true);
  if (!parsed.ok) return createBlockedSession(input, pkg, "BAD_APPLICATION_URL", "Application URL is not safe for browser execution.", "Use a public Greenhouse or Lever application URL.");
  const atsType = detectExecutionAts(parsed.parsed);
  if (input.action === "start-live") {
    const transition = setApplicationPackageExecutionStatus(pkg.id, pkg.packageHash, pkg.version, "SUBMITTING");
    if (!transition.ok) return { ok: false, status: transition.status, error: transition.error };
  }
  const session = createApplicationSession({
    userId: pkg.userId ?? "career-ops-operator",
    profileScope: pkg.profileScope ?? "career-ops",
    applicationPackageId: pkg.id,
    applicationPackageVersion: pkg.version,
    applicationPackageHash: pkg.packageHash,
    atsType,
    applicationUrl: rawUrl,
    canonicalUrl: parsed.url,
    mode: input.action === "start-live" ? "LIVE" : "DRY_RUN",
  });
  if (!session.ok) return { ok: false, status: session.status, error: session.error, code: session.code };
  return runSession(pkg, session.session, input, options);
}
