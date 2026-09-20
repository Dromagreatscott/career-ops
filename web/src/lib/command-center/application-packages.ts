import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { atomicWrite } from "@/lib/core/safe-write";
import { careerOpsRoot } from "@/lib/career-ops";
import { normalizeExternalUrl } from "@/lib/security/url";
import { answerHash, readCompanyAnswerPacks, readReusableAnswers } from "./answer-library";
import { detectAts } from "./ats-adapters";
import { materialProfileFields, profileHash, readProfileRecord } from "./profile-store";
import type {
  ApplicationPackage,
  ApplicationPackageStatus,
  ApplicationQuestion,
  CompensationStatus,
  Job,
  ProfileView,
  ResumeLibraryItem,
} from "./types";

const PACKAGE_DIR = "data/application-packages";
const SCHEMA_VERSION = 1;
const MASTER_RESUME = "data/David_Scott_AI_Resume_2026_v4_4_MASTER_ATS.pdf";
const PACKAGE_ID_RE = /^pkg_[a-f0-9]{16}$/;
const HASH_RE = /^[a-f0-9]{64}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const PACKAGE_AUDIT_LOG = "package-audit.jsonl";
const QUARANTINE_DIR = "quarantine";

type PackageValidationErrorCode =
  | "invalid_id"
  | "invalid_path"
  | "bad_json"
  | "bad_schema"
  | "hash_mismatch"
  | "not_found"
  | "invalid_transition"
  | "stale_version"
  | "stale_hash"
  | "already_decided";

type PackageReadError = {
  ok: false;
  status: number;
  error: string;
  code: PackageValidationErrorCode;
};

type PackageReadOk = {
  ok: true;
  package: ApplicationPackage;
};

type PackageReadResult = PackageReadOk | PackageReadError;

const BASELINE_TRANSITIONS: Record<ApplicationPackageStatus, ApplicationPackageStatus[]> = {
  DISCOVERED: ["EVALUATING"],
  EVALUATING: ["QUALIFIED"],
  QUALIFIED: ["PREPARING"],
  PREPARING: ["READY_FOR_REVIEW", "USER_INTERVENTION_REQUIRED"],
  READY_FOR_REVIEW: ["APPROVED", "REJECTED"],
  APPROVED: ["SUBMITTING"],
  SUBMITTING: ["SUBMITTED", "USER_INTERVENTION_REQUIRED"],
  SUBMITTED: [],
  USER_INTERVENTION_REQUIRED: ["PREPARING", "SUBMITTING"],
  INTERVIEW: [],
  CLOSED: [],
  REJECTED: [],
};

function packageDir(): string {
  return path.join(careerOpsRoot(), PACKAGE_DIR);
}

export function validatePackageId(value: unknown): { ok: true; id: string } | PackageReadError {
  if (typeof value !== "string") return packageError(400, "invalid_id", "invalid package id");
  const raw = value.trim();
  if (raw !== value || !raw) return packageError(400, "invalid_id", "invalid package id");
  try {
    decodeURIComponent(raw);
  } catch {
    return packageError(400, "invalid_id", "invalid package id");
  }
  if (raw.includes("/") || raw.includes("\\") || path.isAbsolute(raw) || !PACKAGE_ID_RE.test(raw)) {
    return packageError(400, "invalid_id", "invalid package id");
  }
  return { ok: true, id: raw };
}

function packagePath(id: string): string {
  const base = path.resolve(packageDir());
  const file = path.resolve(base, `${id}.json`);
  const relative = path.relative(base, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("package path escaped package directory");
  }
  return file;
}

function safeId(value: string): string {
  return `pkg_${crypto.createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function packageError(status: number, code: PackageValidationErrorCode, error: string): PackageReadError {
  return { ok: false, status, code, error };
}

function readJsonFile(file: string): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function auditPackageEvent(type: string, details: Record<string, unknown>) {
  const event = { ts: nowIso(), type, ...details };
  try {
    fs.mkdirSync(packageDir(), { recursive: true });
    fs.appendFileSync(path.join(packageDir(), PACKAGE_AUDIT_LOG), `${JSON.stringify(event)}\n`, "utf8");
  } catch {
    /* best-effort audit */
  }
  console.warn(JSON.stringify({ scope: "application-package", ...event }));
}

function quarantinePackageFile(file: string, code: PackageValidationErrorCode, packageId?: string) {
  const base = path.resolve(packageDir());
  const resolved = path.resolve(file);
  const relative = path.relative(base, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative) || relative.includes(path.sep + QUARANTINE_DIR + path.sep)) return;
  const safeName = path.basename(file).replace(/[^a-zA-Z0-9._-]/g, "_");
  try {
    fs.mkdirSync(path.join(base, QUARANTINE_DIR), { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.renameSync(resolved, path.join(base, QUARANTINE_DIR, `${safeName}.bad-${stamp}`));
  } catch {
    /* best-effort quarantine */
  }
  auditPackageEvent("application_package_quarantined", { code, packageId: packageId ?? "unknown" });
}

function normalizeForHash(pkg: Omit<ApplicationPackage, "packageHash">): unknown {
  const { status: _status, approval: _approval, createdAt: _createdAt, updatedAt: _updatedAt, ...hashable } = pkg;
  return hashable;
}

export function computePackageHash(pkg: Omit<ApplicationPackage, "packageHash">): string {
  return crypto.createHash("sha256").update(JSON.stringify(normalizeForHash(pkg))).digest("hex");
}

function withHash(pkg: Omit<ApplicationPackage, "packageHash">): ApplicationPackage {
  return { ...pkg, packageHash: computePackageHash(pkg) };
}

function recomputePackageHash(pkg: ApplicationPackage): string {
  const { packageHash: _packageHash, ...withoutHash } = pkg;
  return computePackageHash(withoutHash);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIso(value: unknown): value is string {
  return typeof value === "string" && ISO_RE.test(value) && Number.isFinite(Date.parse(value));
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isPackageStatus(value: unknown): value is ApplicationPackageStatus {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(BASELINE_TRANSITIONS, value);
}

function validateApproval(pkg: Record<string, unknown>): boolean {
  const approval = pkg.approval;
  if (approval === undefined) return true;
  if (!isRecord(approval)) return false;
  if (approval.status !== "approved" && approval.status !== "rejected") return false;
  if (typeof approval.packageHash !== "string" || !HASH_RE.test(approval.packageHash)) return false;
  if (!isIso(approval.decidedAt)) return false;
  return approval.packageHash === pkg.packageHash;
}

function validateApplicationQuestion(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!isString(value.id) || !isString(value.label) || !isString(value.explanation)) return false;
  if (value.classification !== "SAFE_AUTOFILL" && value.classification !== "REVIEW_REQUIRED" && value.classification !== "USER_REQUIRED") return false;
  if (value.source !== "profile" && value.source !== "career_ops" && value.source !== "user") return false;
  if (value.value !== undefined && typeof value.value !== "string") return false;
  if (value.draft !== undefined && typeof value.draft !== "string") return false;
  return true;
}

function validateApplicationPackageShape(value: unknown): value is ApplicationPackage {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== SCHEMA_VERSION) return false;
  if (!validatePackageId(value.id).ok) return false;
  if (!isString(value.jobId)) return false;
  if (value.trackerNumber !== undefined && typeof value.trackerNumber !== "string") return false;
  if (typeof value.version !== "number" || !Number.isSafeInteger(value.version) || value.version < 1) return false;
  if (typeof value.packageHash !== "string" || !HASH_RE.test(value.packageHash)) return false;
  if (!isString(value.company) || !isString(value.title)) return false;
  if (!isPackageStatus(value.status)) return false;
  if (value.userId !== undefined && typeof value.userId !== "string") return false;
  if (value.profileScope !== undefined && typeof value.profileScope !== "string") return false;
  if (value.profileSnapshot !== undefined) {
    if (!isRecord(value.profileSnapshot)) return false;
    if (typeof value.profileSnapshot.version !== "number" || !Number.isSafeInteger(value.profileSnapshot.version)) return false;
    if (typeof value.profileSnapshot.hash !== "string" || !HASH_RE.test(value.profileSnapshot.hash)) return false;
    if (!isString(value.profileSnapshot.reference)) return false;
  }
  if (value.approvalRequired !== "prepare_application" || value.submitApprovalRequired !== "submit_application") return false;
  if (!isString(value.materialSummary)) return false;
  if (value.atsType !== "greenhouse" && value.atsType !== "lever" && value.atsType !== "ashby" && value.atsType !== "workday" && value.atsType !== "unknown") return false;
  if (!isString(value.canonicalJobUrl) || !normalizeExternalUrl(value.canonicalJobUrl)) return false;
  if (value.canonicalApplyUrl !== undefined && !normalizeExternalUrl(value.canonicalApplyUrl)) return false;
  if (value.baseRoleFit !== null && (typeof value.baseRoleFit !== "number" || !Number.isFinite(value.baseRoleFit))) return false;
  if (value.compensationStatus !== "preferred" && value.compensationStatus !== "eligible_unknown" && value.compensationStatus !== "comp_exception_low_priority" && value.compensationStatus !== "unknown") return false;
  if (!stringArray(value.roleFitExplanation)) return false;
  if (!isRecord(value.selectedResume) || !isString(value.selectedResume.label)) return false;
  if (value.selectedResume.id !== undefined && typeof value.selectedResume.id !== "string") return false;
  if (value.selectedResume.path !== undefined && typeof value.selectedResume.path !== "string") return false;
  if (value.selectedResume.status !== "ready" && value.selectedResume.status !== "pending") return false;
  if (value.selectedResume.version !== undefined && (typeof value.selectedResume.version !== "number" || !Number.isSafeInteger(value.selectedResume.version))) return false;
  if (value.selectedResume.selection !== undefined && value.selectedResume.selection !== "recommended" && value.selectedResume.selection !== "override") return false;
  if (value.selectedResume.recommendationReason !== undefined && typeof value.selectedResume.recommendationReason !== "string") return false;
  if (value.selectedResume.overrideReason !== undefined && typeof value.selectedResume.overrideReason !== "string") return false;
  if (value.reusableAnswerRefs !== undefined) {
    if (!Array.isArray(value.reusableAnswerRefs)) return false;
    if (!value.reusableAnswerRefs.every((item) => isRecord(item) && isString(item.id) && HASH_RE.test(String(item.hash)) && (item.classification === "SAFE_AUTOFILL" || item.classification === "REVIEW_REQUIRED" || item.classification === "USER_REQUIRED"))) return false;
  }
  if (value.companyAnswerRefs !== undefined) {
    if (!Array.isArray(value.companyAnswerRefs)) return false;
    if (!value.companyAnswerRefs.every((item) => isRecord(item) && isString(item.packId) && isString(item.entryId) && HASH_RE.test(String(item.hash)) && (item.classification === "SAFE_AUTOFILL" || item.classification === "REVIEW_REQUIRED" || item.classification === "USER_REQUIRED"))) return false;
  }
  if (value.packageIssues !== undefined) {
    if (!isRecord(value.packageIssues)) return false;
    if (!stringArray(value.packageIssues.missingFields) || !stringArray(value.packageIssues.reviewRequiredFields) || !stringArray(value.packageIssues.userRequiredFields) || !stringArray(value.packageIssues.warnings)) return false;
  }
  if (!stringArray(value.tailoredResumeChanges)) return false;
  if (!isRecord(value.coverLetter) || typeof value.coverLetter.useful !== "boolean") return false;
  if (value.coverLetter.status !== "ready" && value.coverLetter.status !== "not_needed" && value.coverLetter.status !== "pending") return false;
  if (value.coverLetter.draft !== undefined && typeof value.coverLetter.draft !== "string") return false;
  if (!Array.isArray(value.questions) || !value.questions.every(validateApplicationQuestion)) return false;
  if (value.outreachDraft !== undefined) {
    if (!isRecord(value.outreachDraft)) return false;
    if (value.outreachDraft.channel !== "linkedin_dm" && value.outreachDraft.channel !== "email") return false;
    if (!isString(value.outreachDraft.body)) return false;
    if (value.outreachDraft.status !== "draft_ready" && value.outreachDraft.status !== "pending") return false;
  }
  if (!validateApproval(value)) return false;
  if (value.reportHref !== undefined && typeof value.reportHref !== "string") return false;
  if (!isIso(value.createdAt) || !isIso(value.updatedAt)) return false;
  return true;
}

export function canTransitionPackageStatus(from: ApplicationPackageStatus, to: ApplicationPackageStatus): boolean {
  if (from === to) return true;
  return BASELINE_TRANSITIONS[from]?.includes(to) ?? false;
}

function assertPackageStatusTransition(from: ApplicationPackageStatus, to: ApplicationPackageStatus): PackageReadError | null {
  if (canTransitionPackageStatus(from, to)) return null;
  return packageError(409, "invalid_transition", "invalid application package transition");
}

function readApplicationPackageFromPath(file: string, expectedId?: string, quarantine = true): PackageReadResult {
  const parsed = readJsonFile(file);
  const packageId = isRecord(parsed) && typeof parsed.id === "string" ? parsed.id : expectedId;
  if (!parsed) {
    if (quarantine) quarantinePackageFile(file, "bad_json", packageId);
    return packageError(422, "bad_json", "application package is invalid and has been isolated");
  }
  if (!validateApplicationPackageShape(parsed)) {
    if (quarantine) quarantinePackageFile(file, "bad_schema", packageId);
    return packageError(422, "bad_schema", "application package is invalid and has been isolated");
  }
  if (expectedId && parsed.id !== expectedId) {
    if (quarantine) quarantinePackageFile(file, "bad_schema", parsed.id);
    return packageError(422, "bad_schema", "application package is invalid and has been isolated");
  }
  const actualHash = recomputePackageHash(parsed);
  if (actualHash !== parsed.packageHash) {
    if (quarantine) quarantinePackageFile(file, "hash_mismatch", parsed.id);
    return packageError(409, "hash_mismatch", "application package changed unexpectedly and has been isolated");
  }
  if (parsed.approval && parsed.approval.packageHash !== actualHash) {
    if (quarantine) quarantinePackageFile(file, "hash_mismatch", parsed.id);
    return packageError(409, "hash_mismatch", "application package approval is stale and has been isolated");
  }
  return { ok: true, package: parsed };
}

function compensationStatus(compensation?: string): CompensationStatus {
  const text = String(compensation ?? "").toLowerCase();
  if (!text || /undisclosed|unknown|unavailable/.test(text)) return "eligible_unknown";
  const moneyValues = [...text.matchAll(/\$?\s*(\d{2,3})(?:\.\d+)?\s*k/g)].map((match) => Number(match[1]) * 1000);
  if (!moneyValues.length) return "unknown";
  const max = Math.max(...moneyValues);
  if (max < 150000) return "comp_exception_low_priority";
  return max >= 175000 ? "preferred" : "eligible_unknown";
}

function roleFitExplanation(job: Job): string[] {
  const evidence = job.evaluation?.strongestEvidence ?? [];
  const concerns = job.evaluation?.hardMismatches ?? [];
  const bullets = [
    job.fitSummary,
    ...evidence.slice(0, 3),
    ...concerns.slice(0, 1).map((concern) => `Concern to review: ${concern}`),
  ].filter(Boolean);
  return [...new Set(bullets)].slice(0, 4);
}

function fallbackResume(): ResumeLibraryItem {
  const absolute = path.join(careerOpsRoot(), MASTER_RESUME);
  const ready = fs.existsSync(absolute);
  return {
    id: "resume-master-ats",
    label: "David Scott Applied AI Resume",
    path: MASTER_RESUME,
    format: "pdf",
    status: ready ? "ready" : "missing",
    isDefault: true,
    recommendedFor: ["Applied AI", "AI architecture", "AI transformation", "agentic operations"],
    notes: "Default ATS-ready resume for application packages.",
  };
}

function scoreResume(resume: ResumeLibraryItem, job: Job): number {
  const haystack = `${resume.label} ${resume.recommendedFor.join(" ")} ${resume.notes ?? ""}`.toLowerCase();
  const role = `${job.title} ${job.fitSummary} ${job.evaluation?.summary ?? ""}`.toLowerCase();
  let score = resume.isDefault ? 20 : 0;
  if (resume.status === "ready") score += 10;
  if (resume.format === "pdf") score += 4;
  for (const term of ["applied ai", "ai architect", "solutions architect", "agentic", "transformation", "automation"]) {
    if (role.includes(term) && haystack.includes(term)) score += 8;
  }
  if (/product|program|director|head/.test(role) && /leader|director|transformation/.test(haystack)) score += 5;
  return score;
}

function selectedResumeFor(
  profile: ProfileView,
  job: Job,
  existing?: ApplicationPackage,
  overrideResumeId?: string,
): ApplicationPackage["selectedResume"] {
  const library = (profile.resumeLibrary?.length ? profile.resumeLibrary : [fallbackResume()]);
  const overrideId = overrideResumeId ?? (existing?.selectedResume.selection === "override" ? existing.selectedResume.id : undefined);
  const override = overrideId ? library.find((resume) => resume.id === overrideId) : undefined;
  const recommended = [...library].sort((a, b) => scoreResume(b, job) - scoreResume(a, job))[0] ?? fallbackResume();
  const chosen = override ?? recommended;
  return {
    id: chosen.id,
    label: chosen.label,
    path: chosen.status === "ready" ? chosen.path : undefined,
    status: chosen.status === "ready" ? "ready" : "pending",
    version: chosen.version ?? 1,
    selection: override ? "override" : "recommended",
    recommendationReason: override
      ? `David override. Career Ops recommended ${recommended.label}.`
      : `Recommended for ${job.title} based on ready status, ATS format, and role alignment.`,
    overrideReason: override ? "Manual resume override selected during package review." : undefined,
  };
}

function packageIssues(questions: ApplicationQuestion[], selectedResume: ApplicationPackage["selectedResume"], atsType: ApplicationPackage["atsType"]): ApplicationPackage["packageIssues"] {
  return {
    missingFields: questions.filter((question) => !question.value && !question.draft).map((question) => question.id),
    reviewRequiredFields: questions.filter((question) => question.classification === "REVIEW_REQUIRED").map((question) => question.id),
    userRequiredFields: questions.filter((question) => question.classification === "USER_REQUIRED").map((question) => question.id),
    warnings: [
      atsType === "unknown" ? "ATS is not supported yet; this package can be reviewed but not executed." : "",
      selectedResume.status !== "ready" ? "Selected resume file is pending." : "",
    ].filter(Boolean),
  };
}

function reusableAnswerRefs(profile: ProfileView): ApplicationPackage["reusableAnswerRefs"] {
  return readReusableAnswers(profile.userId ?? "career-ops-operator", profile.profileScope ?? "career-ops").map((answer) => ({
    id: answer.id,
    classification: answer.classification ?? "REVIEW_REQUIRED",
    hash: answerHash(answer),
  }));
}

function companyAnswerRefs(profile: ProfileView, company: string): ApplicationPackage["companyAnswerRefs"] {
  return readCompanyAnswerPacks(profile.userId ?? "career-ops-operator", profile.profileScope ?? "career-ops")
    .filter((pack) => [pack.company, ...pack.aliases].map((item) => item.toLowerCase()).includes(company.toLowerCase()))
    .flatMap((pack) => pack.entries.filter((entry) => !entry.isArchived).map((entry) => ({
      packId: pack.id,
      entryId: entry.id,
      classification: entry.classification,
      hash: answerHash(entry),
    })));
}

function applicationQuestions(profile: ProfileView, job: Job): ApplicationQuestion[] {
  const workAuth = profile.standardAnswers.work_authorization?.trim();
  const onsite = profile.standardAnswers.onsite_availability?.trim();
  return [
    {
      id: "work_authorization",
      label: "Are you authorized to work in the United States?",
      classification: workAuth ? "SAFE_AUTOFILL" : "USER_REQUIRED",
      value: workAuth || undefined,
      source: workAuth ? "profile" : "user",
      explanation: workAuth ? "Verified profile answer." : "Profile answer is missing.",
    },
    {
      id: "onsite_availability",
      label: "Are you able to work in the required location or arrangement?",
      classification: onsite ? "REVIEW_REQUIRED" : "USER_REQUIRED",
      draft: onsite || undefined,
      source: onsite ? "profile" : "user",
      explanation: onsite ? "Review against this role's location before submission." : "Work preference answer is missing.",
    },
    {
      id: "interest_statement",
      label: `Why are you interested in ${job.company}?`,
      classification: "REVIEW_REQUIRED",
      draft: `I am interested in ${job.company} because this ${job.title} role aligns with my applied AI architecture, business transformation, and agentic operations background. The strongest fit is the opportunity to turn AI strategy into practical systems that improve how teams work.`,
      source: "career_ops",
      explanation: "Career Ops draft. David should review tone and specificity.",
    },
    {
      id: "desired_salary",
      label: "Desired salary",
      classification: "USER_REQUIRED",
      draft: "Context: current policy is $175K+ preferred, $150K minimum screening floor; never autofill salary without David.",
      source: "user",
      explanation: "Compensation should never be autofilled by Career Ops.",
    },
  ];
}

function outreachDraft(job: Job): ApplicationPackage["outreachDraft"] {
  return {
    channel: "linkedin_dm",
    status: "pending",
    body: `Hi - I am preparing an application for the ${job.title} role at ${job.company}. My background is in applied AI systems, AI transformation, and agentic operations. I would welcome any context on the team priorities for this role.`,
  };
}

export function buildApplicationPackage(
  job: Job,
  profile: ProfileView,
  options: { status?: ApplicationPackageStatus; existing?: ApplicationPackage; resumeOverrideId?: string } = {},
): ApplicationPackage {
  const timestamp = nowIso();
  const canonicalJobUrl = normalizeExternalUrl(job.sourceUrl);
  if (!canonicalJobUrl) throw new Error("job source URL is not a valid external URL");
  const canonicalApply = normalizeExternalUrl(job.canonicalApplyUrl) ?? canonicalJobUrl;
  const atsRef = detectAts(canonicalApply);
  const status = options.status ?? options.existing?.status ?? "READY_FOR_REVIEW";
  const selectedResume = selectedResumeFor(profile, job, options.existing, options.resumeOverrideId);
  const questions = applicationQuestions(profile, job);
  const persistedProfile = readProfileRecord(profile.userId ?? "career-ops-operator", profile.profileScope ?? "career-ops");
  const atsType = atsRef?.atsType ?? "unknown";
  const base: Omit<ApplicationPackage, "packageHash"> = {
    id: options.existing?.id ?? safeId(job.id),
    schemaVersion: SCHEMA_VERSION,
    jobId: job.id,
    trackerNumber: job.trackerNumber,
    version: options.existing?.version ?? 1,
    company: job.company,
    title: job.title,
    status,
    userId: profile.userId ?? persistedProfile.userId,
    profileScope: profile.profileScope ?? persistedProfile.profileScope,
    profileSnapshot: {
      version: persistedProfile.version,
      hash: profileHash(persistedProfile),
      reference: `profile:${persistedProfile.userId}:${persistedProfile.profileScope}:v${persistedProfile.version}`,
    },
    approvalRequired: "prepare_application",
    submitApprovalRequired: "submit_application",
    materialSummary: "Application package created for David review. External submission is disabled.",
    atsType,
    canonicalJobUrl,
    canonicalApplyUrl: canonicalApply,
    baseRoleFit: job.fitScore,
    compensationStatus: compensationStatus(job.compensation),
    roleFitExplanation: roleFitExplanation(job),
    selectedResume,
    tailoredResumeChanges: [
      "No tailored resume changes generated in this slice.",
      "Career Ops will require review before any role-specific resume edits are used.",
    ],
    coverLetter: {
      useful: Boolean(job.evaluation && (job.fitScore ?? 0) >= 4),
      status: "pending",
      draft: "Cover letter generation is pending. This package can still be reviewed without one.",
    },
    questions,
    reusableAnswerRefs: reusableAnswerRefs(profile),
    companyAnswerRefs: companyAnswerRefs(profile, job.company),
    packageIssues: packageIssues(questions, selectedResume, atsType),
    outreachDraft: outreachDraft(job),
    reportHref: job.reportHref,
    approval: status === "APPROVED" ? options.existing?.approval : undefined,
    createdAt: options.existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  const next = withHash(base);
  if (options.existing && next.packageHash !== options.existing.packageHash) {
    return withHash({
      ...base,
      status: "READY_FOR_REVIEW",
      approval: undefined,
      version: options.existing.version + 1,
    });
  }
  return next;
}

export function readApplicationPackages(): ApplicationPackage[] {
  let files: fs.Dirent[] = [];
  try {
    files = fs.readdirSync(packageDir(), { withFileTypes: true }).filter((file) => file.isFile() && file.name.endsWith(".json"));
  } catch {
    return [];
  }
  return files.flatMap((file) => {
    const id = file.name.replace(/\.json$/, "");
    const validId = validatePackageId(id);
    if (!validId.ok) {
      quarantinePackageFile(path.join(packageDir(), file.name), "invalid_id", id);
      return [];
    }
    const parsed = readApplicationPackageFromPath(path.join(packageDir(), file.name), validId.id);
    return parsed.ok ? [parsed.package] : [];
  });
}

export function findApplicationPackage(id: string): ApplicationPackage | null {
  const result = readApplicationPackage(id);
  return result.ok ? result.package : null;
}

export function readApplicationPackage(id: string): PackageReadResult {
  const validId = validatePackageId(id);
  if (!validId.ok) return validId;
  let file: string;
  try {
    file = packagePath(validId.id);
  } catch {
    return packageError(400, "invalid_path", "invalid package id");
  }
  if (!fs.existsSync(file)) return packageError(404, "not_found", "application package not found");
  return readApplicationPackageFromPath(file, validId.id);
}

export function writeApplicationPackage(pkg: ApplicationPackage): ApplicationPackage {
  if (!validateApplicationPackageShape(pkg)) throw new Error("invalid application package");
  const actualHash = recomputePackageHash(pkg);
  if (actualHash !== pkg.packageHash) throw new Error("application package hash mismatch");
  fs.mkdirSync(packageDir(), { recursive: true });
  atomicWrite(packagePath(pkg.id), `${JSON.stringify(pkg, null, 2)}\n`);
  return pkg;
}

function rehashPackageMutation(pkg: ApplicationPackage, reason: string): ApplicationPackage {
  const { packageHash: _packageHash, ...withoutHash } = pkg;
  return withHash({
    ...withoutHash,
    status: pkg.status === "APPROVED" || pkg.status === "REJECTED" ? "READY_FOR_REVIEW" : pkg.status,
    approval: undefined,
    version: pkg.version + 1,
    materialSummary: `${pkg.materialSummary} Review reset: ${reason}`,
    updatedAt: nowIso(),
  });
}

export function invalidatePackagesForProfileSnapshot(userId: string, profileScope: string, currentProfileHash: string): ApplicationPackage[] {
  const changed = readApplicationPackages().filter((pkg) =>
    pkg.userId === userId &&
    pkg.profileScope === profileScope &&
    pkg.profileSnapshot?.hash &&
    pkg.profileSnapshot.hash !== currentProfileHash &&
    (pkg.status === "APPROVED" || pkg.approval),
  );
  return changed.map((pkg) => writeApplicationPackage(rehashPackageMutation(pkg, "profile facts used by this package changed.")));
}

export function invalidatePackagesForAnswer(answerId: string, nextHash: string): ApplicationPackage[] {
  const changed = readApplicationPackages().filter((pkg) => {
    const reusable = pkg.reusableAnswerRefs?.find((ref) => ref.id === answerId && ref.hash !== nextHash);
    const company = pkg.companyAnswerRefs?.find((ref) => ref.entryId === answerId && ref.hash !== nextHash);
    return Boolean((reusable || company) && (pkg.status === "APPROVED" || pkg.approval));
  });
  return changed.map((pkg) => writeApplicationPackage(rehashPackageMutation(pkg, "answer text used by this package changed.")));
}

export function prepareApplicationPackage(job: Job, profile: ProfileView): ApplicationPackage {
  const existing = findApplicationPackage(safeId(job.id)) ?? undefined;
  const requestedStatus = existing?.status === "APPROVED" ? existing.status : "READY_FOR_REVIEW";
  const pkg = buildApplicationPackage(job, profile, { existing, status: requestedStatus });
  return writeApplicationPackage(pkg);
}

export function overrideApplicationPackageResume(
  id: string,
  packageHash: string,
  expectedVersion: number,
  resumeId: string,
  profile: ProfileView,
  job: Job,
): { ok: true; package: ApplicationPackage } | { ok: false; status: number; error: string } {
  const read = readApplicationPackage(id);
  if (!read.ok) return { ok: false, status: read.status, error: read.error };
  const existing = read.package;
  const actualHash = recomputePackageHash(existing);
  if (actualHash !== existing.packageHash || existing.packageHash !== packageHash) {
    return { ok: false, status: 409, error: "package changed after review; reload before changing resume" };
  }
  if (existing.version !== expectedVersion) {
    return { ok: false, status: 409, error: "package version changed after review; reload before changing resume" };
  }
  const resume = profile.resumeLibrary.find((item) => item.id === resumeId);
  if (!resume) return { ok: false, status: 400, error: "resume is not in the profile library" };
  const next = buildApplicationPackage(job, profile, {
    existing,
    status: existing.status === "APPROVED" || existing.status === "REJECTED" ? "READY_FOR_REVIEW" : existing.status,
    resumeOverrideId: resume.id,
  });
  return { ok: true, package: writeApplicationPackage(next) };
}

export function decideApplicationPackage(
  id: string,
  packageHash: string,
  expectedVersion: number,
  decision: "approved" | "rejected",
): { ok: true; package: ApplicationPackage } | { ok: false; status: number; error: string } {
  const read = readApplicationPackage(id);
  if (!read.ok) return { ok: false, status: read.status, error: read.error };
  const existing = read.package;
  const actualHash = recomputePackageHash(existing);
  if (actualHash !== existing.packageHash) {
    auditPackageEvent("application_package_hash_mismatch", { packageId: existing.id });
    return { ok: false, status: 409, error: "package changed after review; reload before deciding" };
  }
  if (existing.packageHash !== packageHash || actualHash !== packageHash) {
    return { ok: false, status: 409, error: "package changed after review; reload before deciding" };
  }
  if (existing.version !== expectedVersion) {
    return { ok: false, status: 409, error: "package version changed after review; reload before deciding" };
  }
  if (existing.status === "APPROVED" || existing.status === "REJECTED") {
    return { ok: false, status: 409, error: "package decision was already recorded" };
  }
  const targetStatus = decision === "approved" ? "APPROVED" : "REJECTED";
  const transitionError = assertPackageStatusTransition(existing.status, targetStatus);
  if (transitionError) return { ok: false, status: transitionError.status, error: transitionError.error };
  const updated: ApplicationPackage = {
    ...existing,
    status: targetStatus,
    approval: {
      status: decision,
      packageHash,
      decidedAt: nowIso(),
    },
    updatedAt: nowIso(),
  };
  return { ok: true, package: writeApplicationPackage(updated) };
}

export function packageStatusLabel(status: ApplicationPackageStatus): string {
  return status.toLowerCase().replaceAll("_", " ");
}
