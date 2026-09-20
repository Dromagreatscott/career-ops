import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";
import type {
  ApplicationAccountState,
  ApplicationBlockerCode,
  ApplicationDryRunReport,
  ApplicationSession,
  ApplicationSessionAuditEvent,
  ApplicationSessionMode,
  ApplicationSessionStatus,
  AtsType,
} from "./types";

const STORE_REL = "data/web/application-sessions.json";
const SESSION_ID_RE = /^exec_[a-f0-9]{16}$/;

type Store = {
  sessions: ApplicationSession[];
};

function nowIso(): string {
  return new Date().toISOString();
}

function storePath(): string {
  return path.join(careerOpsRoot(), STORE_REL);
}

function readStore(): Store {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), "utf8")) as Store;
    return { sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [] };
  } catch {
    return { sessions: [] };
  }
}

function writeStore(store: Store): Store {
  atomicWriteWithBackup(storePath(), `${JSON.stringify(store, null, 2)}\n`);
  return store;
}

export function validateSessionId(value: unknown): { ok: true; id: string } | { ok: false; error: string } {
  const id = String(value ?? "").trim();
  if (!SESSION_ID_RE.test(id)) return { ok: false, error: "invalid session id" };
  return { ok: true, id };
}

export function readApplicationSessions(): ApplicationSession[] {
  return readStore().sessions;
}

export function findApplicationSession(id: string): ApplicationSession | null {
  const valid = validateSessionId(id);
  if (!valid.ok) return null;
  return readStore().sessions.find((session) => session.id === valid.id) ?? null;
}

function event(type: ApplicationSessionAuditEvent["type"], summary: string, extra: Partial<ApplicationSessionAuditEvent> = {}): ApplicationSessionAuditEvent {
  return { timestamp: nowIso(), type, summary, ...extra };
}

export function appendSessionEvent(id: string, type: ApplicationSessionAuditEvent["type"], summary: string, extra: Partial<ApplicationSessionAuditEvent> = {}): ApplicationSession | null {
  const store = readStore();
  const session = store.sessions.find((item) => item.id === id);
  if (!session) return null;
  session.auditEvents.push(event(type, summary, extra));
  session.updatedAt = nowIso();
  writeStore(store);
  return session;
}

export function createApplicationSession(input: {
  userId: string;
  profileScope: string;
  applicationPackageId: string;
  applicationPackageVersion: number;
  applicationPackageHash: string;
  atsType: AtsType;
  applicationUrl: string;
  canonicalUrl: string;
  mode: ApplicationSessionMode;
}): { ok: true; session: ApplicationSession } | { ok: false; status: number; error: string; code: ApplicationBlockerCode } {
  const store = readStore();
  const submitted = store.sessions.find((session) =>
    session.applicationPackageId === input.applicationPackageId &&
    session.applicationPackageVersion === input.applicationPackageVersion &&
    session.applicationPackageHash === input.applicationPackageHash &&
    session.status === "SUBMITTED",
  );
  if (submitted && input.mode === "LIVE") return { ok: false, status: 409, error: "application package was already submitted", code: "DUPLICATE_SUBMISSION" };
  const activeLive = store.sessions.find((session) =>
    session.mode === "LIVE" &&
    session.status === "SUBMITTING" &&
    session.applicationPackageId === input.applicationPackageId &&
    session.applicationPackageVersion === input.applicationPackageVersion &&
    session.applicationPackageHash === input.applicationPackageHash,
  );
  if (activeLive && input.mode === "LIVE") return { ok: false, status: 409, error: "live execution is already active for this package", code: "DUPLICATE_SUBMISSION" };
  const now = nowIso();
  const session: ApplicationSession = {
    id: `exec_${crypto.randomBytes(8).toString("hex")}`,
    userId: input.userId,
    profileScope: input.profileScope,
    applicationPackageId: input.applicationPackageId,
    applicationPackageVersion: input.applicationPackageVersion,
    applicationPackageHash: input.applicationPackageHash,
    atsType: input.atsType,
    applicationUrl: input.applicationUrl,
    canonicalUrl: input.canonicalUrl,
    mode: input.mode,
    status: "SUBMITTING",
    createdAt: now,
    updatedAt: now,
    lastStep: "SESSION_CREATED",
    requiresUserAction: false,
    accountState: "NO_ACCOUNT_REQUIRED",
    auditEvents: [event("SESSION_CREATED", `${input.mode} execution session created.`)],
  };
  store.sessions.push(session);
  writeStore(store);
  return { ok: true, session };
}

export function updateApplicationSession(
  id: string,
  patch: Partial<Pick<ApplicationSession, "atsType" | "status" | "lastStep" | "lastErrorCode" | "requiresUserAction" | "userActionMessage" | "accountState" | "confirmationId" | "confirmationUrl" | "confirmationSummary" | "submittedAt" | "dryRunReport">>,
  audit?: ApplicationSessionAuditEvent,
): ApplicationSession | null {
  const store = readStore();
  const session = store.sessions.find((item) => item.id === id);
  if (!session) return null;
  Object.assign(session, patch);
  session.updatedAt = nowIso();
  if (audit) session.auditEvents.push({ ...audit, timestamp: audit.timestamp || nowIso() });
  writeStore(store);
  return session;
}

/**
 * Map a blocker code to the account/interaction state the session should surface
 * while it pauses for David. Authentication, account-creation, verification, MFA
 * and CAPTCHA gates each get their own state so the UI can explain exactly what
 * the human has to do next (and so a resume can be gated on the right action).
 * Everything else falls back to the generic USER_INTERVENTION_REQUIRED state.
 * Career Ops never bypasses any of these gates — it pauses and waits.
 */
export function accountStateForBlocker(code: ApplicationBlockerCode): ApplicationAccountState {
  switch (code) {
    case "LOGIN_REQUIRED":
      return "ACCOUNT_EXISTS_LOGIN_REQUIRED";
    case "ACCOUNT_CREATION_REQUIRED":
      return "ACCOUNT_CREATION_REQUIRED";
    case "EMAIL_VERIFICATION_REQUIRED":
      return "EMAIL_VERIFICATION_REQUIRED";
    case "MFA_REQUIRED":
      return "MFA_REQUIRED";
    case "CAPTCHA_REQUIRED":
      return "CAPTCHA_REQUIRED";
    default:
      return "USER_INTERVENTION_REQUIRED";
  }
}

export function markIntervention(id: string, code: ApplicationBlockerCode, message: string, action: string, report?: ApplicationDryRunReport, accountState?: ApplicationAccountState): ApplicationSession | null {
  return updateApplicationSession(id, {
    status: "USER_INTERVENTION_REQUIRED",
    lastStep: "USER_INTERVENTION_REQUIRED",
    lastErrorCode: code,
    requiresUserAction: true,
    userActionMessage: `${message} Action: ${action}`,
    accountState: accountState ?? accountStateForBlocker(code),
    dryRunReport: report,
  }, event("USER_INTERVENTION_REQUIRED", `${code}: ${message}`));
}

export function resumeApplicationSession(id: string): { ok: true; session: ApplicationSession } | { ok: false; status: number; error: string } {
  const session = findApplicationSession(id);
  if (!session) return { ok: false, status: 404, error: "execution session not found" };
  if (session.status !== "USER_INTERVENTION_REQUIRED") return { ok: false, status: 409, error: "session is not waiting for user intervention" };
  const updated = updateApplicationSession(id, {
    status: "SUBMITTING",
    requiresUserAction: false,
    lastStep: "EXECUTION_RESUMED",
    accountState: "APPLICATION_READY",
  }, event("EXECUTION_RESUMED", "David explicitly resumed execution."));
  return { ok: true, session: updated! };
}

export function dryRunReportFromSession(session: ApplicationSession): ApplicationDryRunReport | null {
  return session.dryRunReport ?? null;
}
