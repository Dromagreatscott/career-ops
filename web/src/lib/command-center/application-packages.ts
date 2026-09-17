import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { atomicWrite } from "@/lib/core/safe-write";
import { careerOpsRoot } from "@/lib/career-ops";
import { detectAts } from "./ats-adapters";
import type {
  ApplicationPackage,
  ApplicationPackageStatus,
  ApplicationQuestion,
  CompensationStatus,
  Job,
  ProfileView,
} from "./types";

const PACKAGE_DIR = "data/application-packages";
const SCHEMA_VERSION = 1;
const MASTER_RESUME = "data/David_Scott_AI_Resume_2026_v4_4_MASTER_ATS.pdf";

function packageDir(): string {
  return path.join(careerOpsRoot(), PACKAGE_DIR);
}

function packagePath(id: string): string {
  return path.join(packageDir(), `${id}.json`);
}

function safeId(value: string): string {
  return `pkg_${crypto.createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function readJsonFile<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function hasResume(): boolean {
  try {
    return fs.existsSync(path.join(careerOpsRoot(), MASTER_RESUME));
  } catch {
    return false;
  }
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
  options: { status?: ApplicationPackageStatus; existing?: ApplicationPackage } = {},
): ApplicationPackage {
  const timestamp = nowIso();
  const atsRef = detectAts(job.canonicalApplyUrl || job.sourceUrl);
  const resumeReady = hasResume();
  const status = options.status ?? options.existing?.status ?? "READY_FOR_REVIEW";
  const base: Omit<ApplicationPackage, "packageHash"> = {
    id: options.existing?.id ?? safeId(job.id),
    schemaVersion: SCHEMA_VERSION,
    jobId: job.id,
    trackerNumber: job.trackerNumber,
    version: options.existing?.version ?? 1,
    company: job.company,
    title: job.title,
    status,
    approvalRequired: "prepare_application",
    submitApprovalRequired: "submit_application",
    materialSummary: "Application package created for David review. External submission is disabled.",
    atsType: atsRef?.atsType ?? "unknown",
    canonicalJobUrl: job.sourceUrl,
    canonicalApplyUrl: job.canonicalApplyUrl || job.sourceUrl,
    baseRoleFit: job.fitScore,
    compensationStatus: compensationStatus(job.compensation),
    roleFitExplanation: roleFitExplanation(job),
    selectedResume: {
      label: "David Scott Applied AI Resume",
      path: resumeReady ? MASTER_RESUME : undefined,
      status: resumeReady ? "ready" : "pending",
    },
    tailoredResumeChanges: [
      "No tailored resume changes generated in this slice.",
      "Career Ops will require review before any role-specific resume edits are used.",
    ],
    coverLetter: {
      useful: Boolean(job.evaluation && (job.fitScore ?? 0) >= 4),
      status: "pending",
      draft: "Cover letter generation is pending. This package can still be reviewed without one.",
    },
    questions: applicationQuestions(profile, job),
    outreachDraft: outreachDraft(job),
    reportHref: job.reportHref,
    approval: status === "APPROVED" ? options.existing?.approval : undefined,
    createdAt: options.existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  return withHash(base);
}

export function readApplicationPackages(): ApplicationPackage[] {
  let files: string[] = [];
  try {
    files = fs.readdirSync(packageDir()).filter((file: string) => file.endsWith(".json"));
  } catch {
    return [];
  }
  return files.flatMap((file: string) => {
    const parsed = readJsonFile<ApplicationPackage>(path.join(packageDir(), file));
    return parsed ? [parsed] : [];
  });
}

export function findApplicationPackage(id: string): ApplicationPackage | null {
  const parsed = readJsonFile<ApplicationPackage>(packagePath(id));
  return parsed ?? null;
}

export function writeApplicationPackage(pkg: ApplicationPackage): ApplicationPackage {
  fs.mkdirSync(packageDir(), { recursive: true });
  atomicWrite(packagePath(pkg.id), `${JSON.stringify(pkg, null, 2)}\n`);
  return pkg;
}

export function prepareApplicationPackage(job: Job, profile: ProfileView): ApplicationPackage {
  const existing = findApplicationPackage(safeId(job.id)) ?? undefined;
  const pkg = buildApplicationPackage(job, profile, { existing, status: "READY_FOR_REVIEW" });
  return writeApplicationPackage(pkg);
}

export function decideApplicationPackage(
  id: string,
  packageHash: string,
  decision: "approved" | "rejected",
): { ok: true; package: ApplicationPackage } | { ok: false; status: number; error: string } {
  const existing = findApplicationPackage(id);
  if (!existing) return { ok: false, status: 404, error: "application package not found" };
  if (existing.packageHash !== packageHash) {
    return { ok: false, status: 409, error: "package changed after review; reload before deciding" };
  }
  const updated: ApplicationPackage = {
    ...existing,
    status: decision === "approved" ? "APPROVED" : "REJECTED",
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
