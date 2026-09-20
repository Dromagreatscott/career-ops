import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { careerOpsRoot, readApplications } from "@/lib/career-ops";
import { normalizeExternalUrl } from "@/lib/security/url";
import { companyPrioritiesFromProfile, companyPriorityFor } from "./company-priority";
import { findApplicationPackage, readApplicationPackages } from "./application-packages";
import { readCompanyAnswerPacks, readReusableAnswers } from "./answer-library";
import { canonicalApplyUrl, plainSummary, scoreValue, sourcePlatform, stableId, stageFromEvaluation, stageFromStatus, workArrangementFromText } from "./normalize";
import { profileHash, readProfileRecord } from "./profile-store";
import { readResumeLibrary } from "./resume-library";
import type {
  Application,
  ApplicationPackage,
  Approval,
  AuditEvent,
  CommandCenterData,
  EducationItem,
  EmploymentHistoryItem,
  Evaluation,
  Job,
  Outreach,
  ProfileVerificationItem,
  ProfileView,
  ReusableApplicationAnswer,
  ResumeLibraryItem,
  VerificationState,
} from "./types";

function readText(rel: string): string | null {
  try {
    return fs.readFileSync(path.join(careerOpsRoot(), rel), "utf8");
  } catch {
    return null;
  }
}

function readJson<T>(rel: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(path.join(careerOpsRoot(), rel), "utf8")) as T;
  } catch {
    return fallback;
  }
}

function readProfileYaml(): Record<string, unknown> | null {
  const raw = readText("config/profile.yml");
  if (!raw) return null;
  try {
    const parsed = yaml.load(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((s) => s.trim()).filter(Boolean) : [];
}

function verificationFor(value: string | undefined, needsReview = false): VerificationState {
  if (!value?.trim()) return "missing";
  return needsReview ? "needs_review" : "verified";
}

function fileUpdatedAt(rel: string): string | undefined {
  try {
    return fs.statSync(path.join(careerOpsRoot(), rel)).mtime.toISOString();
  } catch {
    return undefined;
  }
}

function sectionFromMarkdown(md: string | null, heading: string): string {
  if (!md) return "";
  const lines = md.split("\n");
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (start === -1) return "";
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) break;
    body.push(lines[i]);
  }
  return body.join("\n").trim();
}

function parseEmploymentHistory(cv: string | null): EmploymentHistoryItem[] {
  const section = sectionFromMarkdown(cv, "Professional Experience");
  if (!section) return [];

  const chunks = section.split(/^###\s+/m).map((chunk) => chunk.trim()).filter(Boolean);
  return chunks.map((chunk) => {
    const lines = chunk.split("\n").map((line) => line.trim()).filter(Boolean);
    const organizationLine = lines.shift() ?? "";
    const [organization, ...locationParts] = organizationLine.split(",").map((part) => part.trim()).filter(Boolean);
    let title: string | undefined;
    let dates: string | undefined;
    const highlights: string[] = [];

    for (const line of lines) {
      const titleMatch = line.match(/^\*\*(.+?)\*\*$/);
      if (titleMatch && !title) {
        title = titleMatch[1].trim();
        continue;
      }
      if (!dates && !line.startsWith("-") && /\b(?:present|\d{4})\b/i.test(line)) {
        dates = line;
        continue;
      }
      if (line.startsWith("-")) highlights.push(line.replace(/^-\s*/, "").trim());
    }

    return {
      organization: organization || organizationLine,
      location: locationParts.join(", ") || undefined,
      title,
      dates,
      highlights: highlights.slice(0, 2),
    };
  });
}

function parseEducation(cv: string | null): EducationItem[] {
  const section = sectionFromMarkdown(cv, "Education & Professional Development");
  if (!section) return [];

  return section.split("\n").flatMap((line) => {
    const clean = line.trim().replace(/^-\s*/, "");
    if (!clean) return [];
    const boldMatch = clean.match(/^\*\*(.+?),\*\*\s*(.+)$/);
    if (boldMatch) return [{ label: boldMatch[1].trim(), details: boldMatch[2].trim() }];
    return [{ label: clean.replace(/\*\*/g, "") }];
  });
}

function parsePortfolio(profile: Record<string, unknown> | null, cv: string | null): string[] {
  const candidate = asRecord(profile?.candidate);
  const configured = [candidate.portfolio_url, candidate.linkedin, candidate.github].map((value) => String(value ?? "").trim()).filter(Boolean);
  const portfolioSection = sectionFromMarkdown(cv, "Industries & Portfolio");
  const urls = portfolioSection.match(/https?:\/\/[^\s)]+|(?:[\w-]+\.)+[a-z]{2,}(?:\/[^\s)]*)?/gi) ?? [];
  return [...new Set([...configured, ...urls.map((url) => url.replace(/[.,;]+$/, ""))])];
}

function resumeFormat(rel: string): ResumeLibraryItem["format"] {
  const ext = path.extname(rel).toLowerCase();
  if (ext === ".pdf") return "pdf";
  if (ext === ".docx") return "docx";
  if (ext === ".html" || ext === ".htm") return "html";
  if (ext === ".md") return "md";
  if (ext === ".txt") return "txt";
  return "other";
}

function resumeLabel(rel: string): string {
  if (rel === "cv.md") return "Canonical Career Ops CV";
  return path.basename(rel, path.extname(rel)).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function resumeLibrary(): ResumeLibraryItem[] {
  const persisted = readResumeLibrary("career-ops-operator", "career-ops");
  if (persisted.length) return persisted;
  const candidates = new Set<string>(["data/David_Scott_AI_Resume_2026_v4_4_MASTER_ATS.pdf", "cv.md"]);
  try {
    for (const entry of fs.readdirSync(path.join(careerOpsRoot(), "data"), { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!/\.(pdf|docx|html?|md|txt)$/i.test(entry.name)) continue;
      if (!/(resume|cv)/i.test(entry.name)) continue;
      candidates.add(`data/${entry.name}`);
    }
  } catch {
    /* data directory is optional in tests */
  }

  return [...candidates].map((rel) => {
    const absolute = path.join(careerOpsRoot(), rel);
    const exists = fs.existsSync(absolute);
    const isDefault = /MASTER_ATS\.pdf$/i.test(rel);
    return {
      id: stableId("resume", rel),
      label: isDefault ? "David Scott Applied AI Resume" : resumeLabel(rel),
      path: rel,
      format: resumeFormat(rel),
      status: exists ? "ready" as const : "missing" as const,
      isDefault,
      recommendedFor: isDefault
        ? ["Applied AI", "AI architecture", "AI transformation", "agentic operations"]
        : ["Profile source", "manual review"],
      notes: isDefault ? "Default ATS-ready resume for application packages." : undefined,
      updatedAt: exists ? fileUpdatedAt(rel) : undefined,
    };
  }).sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.label.localeCompare(b.label));
}

function reusableAnswers(standardAnswers: Record<string, string>, profile: Record<string, unknown> | null): ReusableApplicationAnswer[] {
  const persisted = readReusableAnswers("career-ops-operator", "career-ops");
  if (persisted.length) return persisted;
  const compensation = asRecord(profile?.compensation);
  const coverLetter = asRecord(profile?.cover_letter);
  const answers: ReusableApplicationAnswer[] = [
    {
      id: "work_authorization",
      label: "US work authorization",
      value: standardAnswers.work_authorization ?? "",
      category: "authorization",
      verification: verificationFor(standardAnswers.work_authorization),
      safeToAutofill: Boolean(standardAnswers.work_authorization?.trim()),
    },
    {
      id: "onsite_availability",
      label: "Location and onsite availability",
      value: standardAnswers.onsite_availability ?? "",
      category: "location",
      verification: verificationFor(standardAnswers.onsite_availability, true),
      safeToAutofill: false,
    },
    {
      id: "notice_period",
      label: "Notice period",
      value: standardAnswers.notice_period ? `${standardAnswers.notice_period} days` : "",
      category: "logistics",
      verification: verificationFor(standardAnswers.notice_period),
      safeToAutofill: Boolean(standardAnswers.notice_period?.trim()),
    },
    {
      id: "salary_policy",
      label: "Compensation policy",
      value: String(compensation.target_range ?? compensation.target_floor ?? ""),
      category: "compensation",
      verification: verificationFor(String(compensation.target_range ?? ""), true),
      safeToAutofill: false,
    },
    {
      id: "primary_domain",
      label: "Primary domain",
      value: String(coverLetter.primary_domain ?? ""),
      category: "narrative",
      verification: verificationFor(String(coverLetter.primary_domain ?? ""), true),
      safeToAutofill: false,
    },
  ];
  return answers;
}

function profileVerification(
  contact: ProfileView["contact"],
  answers: ReusableApplicationAnswer[],
  resumes: ResumeLibraryItem[],
): ProfileVerificationItem[] {
  return [
    {
      id: "contact",
      label: "Contact information",
      status: verificationFor([contact.fullName, contact.email, contact.phone, contact.location].filter(Boolean).join(" ")),
      source: "config/profile.yml",
      detail: "Name, email, phone, and location are present.",
      updatedAt: fileUpdatedAt("config/profile.yml"),
    },
    {
      id: "work_authorization",
      label: "Work authorization",
      status: answers.find((answer) => answer.id === "work_authorization")?.verification ?? "missing",
      source: "config/profile.yml",
      detail: "Used for safe autofill when present.",
      updatedAt: fileUpdatedAt("config/profile.yml"),
    },
    {
      id: "location",
      label: "Location constraints",
      status: answers.find((answer) => answer.id === "onsite_availability")?.verification ?? "missing",
      source: "config/profile.yml",
      detail: "Always reviewed against each role before submission.",
      updatedAt: fileUpdatedAt("config/profile.yml"),
    },
    {
      id: "compensation",
      label: "Compensation guidance",
      status: answers.find((answer) => answer.id === "salary_policy")?.verification ?? "missing",
      source: "config/profile.yml",
      detail: "Never autofilled without David.",
      updatedAt: fileUpdatedAt("config/profile.yml"),
    },
    {
      id: "resume_library",
      label: "Resume library",
      status: resumes.some((resume) => resume.status === "ready") ? "verified" : "missing",
      source: "data/",
      detail: `${resumes.filter((resume) => resume.status === "ready").length} ready resume source(s).`,
    },
  ];
}

type PipelineEntry = {
  done: boolean;
  url: string;
  company: string;
  title: string;
  location?: string;
  compensation?: string;
  postedDate?: string;
  discoveredDate?: string;
  sourceLabel?: string;
  rawNotes?: string;
};

function parsePipeline(): PipelineEntry[] {
  const md = readText("data/pipeline.md");
  if (!md) return [];
  const entries: PipelineEntry[] = [];
  for (const line of md.split("\n")) {
    const match = line.match(/^\s*-\s*\[([ xX])\]\s*(.+)$/);
    if (!match) continue;
    const parts = match[2].split("|").map((part) => part.trim()).filter(Boolean);
    const normalizedUrl = normalizeExternalUrl(parts[0]);
    if (parts.length < 3 || !normalizedUrl) continue;
    const extras = parts.slice(3);
    const entry: PipelineEntry = {
      done: match[1].toLowerCase() === "x",
      url: normalizedUrl,
      company: parts[1],
      title: parts[2],
      rawNotes: extras.join(" | ") || undefined,
    };
    for (const extra of extras) {
      if (/^comp:/i.test(extra)) entry.compensation = extra.replace(/^comp:\s*/i, "");
      else if (/^(posted|published):/i.test(extra)) entry.postedDate = extra.replace(/^(posted|published):\s*/i, "");
      else if (/^added:/i.test(extra)) entry.discoveredDate = extra.replace(/^added:\s*/i, "");
      else if (/^(source|verified|linkedin|req|team|closes|ends):/i.test(extra)) entry.sourceLabel = [entry.sourceLabel, extra].filter(Boolean).join(" | ");
      else if (!entry.location) entry.location = extra;
    }
    entries.push(entry);
  }
  return entries;
}

type HawkeyeJob = {
  job_id?: string;
  fields?: Record<string, { value?: unknown }>;
  decision?: { state?: string };
  evaluation?: {
    status?: string;
    evaluation_status?: string;
    score_trust?: string;
    canonical_score?: number | null;
    recommendation?: string;
    strongest_evidence?: string[];
    hard_mismatches?: string[];
    summary?: string;
  };
};

function field(job: HawkeyeJob, key: string): string {
  const value = job.fields?.[key]?.value;
  return value == null ? "" : String(value);
}

function evaluationFromHawkeye(job: HawkeyeJob): Evaluation | undefined {
  const evaluation = job.evaluation;
  if (!evaluation) return undefined;
  const score = typeof evaluation.canonical_score === "number" ? evaluation.canonical_score : null;
  const hardMismatches = Array.isArray(evaluation.hard_mismatches) ? evaluation.hard_mismatches.map(String) : [];
  const strongestEvidence = Array.isArray(evaluation.strongest_evidence) ? evaluation.strongest_evidence.map(String) : [];
  return {
    status: evaluation.evaluation_status || evaluation.status || "pending_career_ops_evaluation",
    score,
    scoreLabel: score == null ? "Not scored" : `${score}/5`,
    scoreTrust: evaluation.score_trust || "unknown",
    recommendation: evaluation.recommendation || "watch",
    summary: evaluation.summary || plainSummary({ score, hardMismatches }),
    strongestEvidence,
    hardMismatches,
  };
}

function hawkeyeJobs(): Job[] {
  const payload = readJson<{ jobs?: HawkeyeJob[] }>("data/hawkeye/jobs.json", { jobs: [] });
  const profile = readProfileYaml();
  const priorities = companyPrioritiesFromProfile(profile);
  return (payload.jobs ?? []).flatMap((job) => {
    const company = field(job, "company");
    const title = field(job, "title");
    const sourceUrl = normalizeExternalUrl(field(job, "source_url"));
    if (!sourceUrl) return [];
    const evaluation = evaluationFromHawkeye(job);
    const priority = companyPriorityFor(company, priorities);
    const canonical = canonicalApplyUrl(sourceUrl);
    const score = evaluation?.score ?? null;
    return [{
      id: job.job_id || stableId("hawkeye", sourceUrl || `${company}-${title}`),
      company,
      title,
      location: field(job, "location") || undefined,
      compensation: field(job, "compensation") || undefined,
      postedDate: undefined,
      discoveredDate: field(job, "discovered_date") || undefined,
      workArrangement: field(job, "work_arrangement") || workArrangementFromText(field(job, "location"), title),
      source: field(job, "source") || "Hawkeye",
      applicationPlatform: sourcePlatform(sourceUrl),
      sourceUrl,
      canonicalApplyUrl: canonical,
      canonicalApplyStatus: canonical ? "resolved" : "needs_resolution",
      fitScore: score,
      fitSummary: plainSummary({ score, recommendation: evaluation?.recommendation, dreamCompany: priority.tier === 1, title, hardMismatches: evaluation?.hardMismatches }),
      evaluation,
      companyPriority: priority,
      dreamCompany: priority.tier === 1,
      stage: stageFromEvaluation(evaluation?.status, score),
      status: job.decision?.state,
    }];
  });
}

function pipelineJobs(): Job[] {
  const profile = readProfileYaml();
  const priorities = companyPrioritiesFromProfile(profile);
  return parsePipeline().map((entry) => {
    const priority = companyPriorityFor(entry.company, priorities);
    const canonical = canonicalApplyUrl(entry.url);
    return {
      id: stableId("pipeline", entry.url),
      company: entry.company,
      title: entry.title,
      location: entry.location,
      compensation: entry.compensation,
      postedDate: entry.postedDate,
      discoveredDate: entry.discoveredDate,
      workArrangement: workArrangementFromText(entry.location, entry.title),
      source: entry.sourceLabel || sourcePlatform(entry.url),
      applicationPlatform: sourcePlatform(entry.url),
      sourceUrl: entry.url,
      canonicalApplyUrl: canonical,
      canonicalApplyStatus: canonical ? "resolved" : "needs_resolution",
      fitScore: null,
      fitSummary: plainSummary({ score: null, dreamCompany: priority.tier === 1, title: entry.title }),
      companyPriority: priority,
      dreamCompany: priority.tier === 1,
      stage: entry.done ? "Evaluating" : "Discovered",
      rawNotes: entry.rawNotes,
    };
  });
}

function trackerApplications(jobs: Job[], packages: ApplicationPackage[]): Application[] {
  const byCompanyTitle = new Map<string, Job>();
  for (const job of jobs) byCompanyTitle.set(`${job.company.toLowerCase()}|${job.title.toLowerCase()}`, job);
  return readApplications().map((row) => {
    const match = byCompanyTitle.get(`${row.company.toLowerCase()}|${row.role.toLowerCase()}`);
    const score = scoreValue(row.score);
    const reportMatch = row.report.match(/\(([^)]+)\)/);
    const app: Application = {
      id: row.n ? `tracker-${row.n}` : stableId("tracker", `${row.company}-${row.role}-${row.date}`),
      jobId: match?.id,
      trackerNumber: row.n || undefined,
      company: row.company,
      title: row.role,
      stage: stageFromStatus(row.status),
      status: row.status,
      score,
      scoreLabel: row.score || (score == null ? "Not scored" : `${score}/5`),
      canonicalApplyUrl: match?.canonicalApplyUrl,
      sourceUrl: match?.sourceUrl,
      reportHref: reportMatch?.[1]?.replace(/^\.\.\//, "/") || undefined,
      notes: row.notes,
      updatedDate: row.date,
    };
    app.applicationPackage = packages.find((pkg) => pkg.jobId === app.jobId || pkg.trackerNumber === app.trackerNumber);
    return app;
  });
}

function mergeJobs(): Job[] {
  const jobs = [...hawkeyeJobs(), ...pipelineJobs()];
  const tracker = readApplications();
  for (const row of tracker) {
    const score = scoreValue(row.score);
    const existing = jobs.find((job) => job.company.toLowerCase() === row.company.toLowerCase() && job.title.toLowerCase() === row.role.toLowerCase());
    if (existing) {
      existing.trackerNumber = row.n;
      existing.status = row.status;
      existing.stage = stageFromStatus(row.status);
      existing.fitScore = existing.fitScore ?? score;
      existing.reportHref = row.report.match(/\(([^)]+)\)/)?.[1]?.replace(/^\.\.\//, "/");
      if (!existing.evaluation && score != null) {
        existing.evaluation = {
          status: row.status,
          score,
          scoreLabel: row.score,
          scoreTrust: "tracker",
          recommendation: score >= 4 ? "watch" : "review",
          summary: plainSummary({ score, dreamCompany: existing.dreamCompany, title: existing.title }),
          strongestEvidence: [],
          hardMismatches: [],
          reportNumber: row.n,
        };
      }
    }
  }

  const seen = new Map<string, Job>();
  for (const job of jobs) {
    const key = job.sourceUrl || `${job.company.toLowerCase()}|${job.title.toLowerCase()}|${job.location ?? ""}`;
    const prior = seen.get(key);
    if (!prior) seen.set(key, job);
    else if ((job.fitScore ?? -1) > (prior.fitScore ?? -1)) seen.set(key, { ...prior, ...job });
  }
  return [...seen.values()].sort((a, b) => {
    const dream = Number(b.dreamCompany) - Number(a.dreamCompany);
    if (dream) return dream;
    return (b.fitScore ?? -1) - (a.fitScore ?? -1);
  });
}

function profileView(profile: Record<string, unknown> | null): ProfileView {
  const persistedProfile = readProfileRecord("career-ops-operator", "career-ops");
  const candidate = asRecord(profile?.candidate);
  const targetRoles = asRecord(profile?.target_roles);
  const compensation = asRecord(profile?.compensation);
  const location = asRecord(profile?.location);
  const cv = readText("cv.md");
  const standardAnswers = {
    work_authorization: String(location.visa_status ?? ""),
    onsite_availability: String(location.onsite_availability ?? ""),
    notice_period: String(asRecord(profile?.cover_letter).notice_period_days ?? ""),
  };
  const contact = {
    fullName: String(candidate.full_name ?? ""),
    email: String(candidate.email ?? ""),
    phone: String(candidate.phone ?? ""),
    location: String(candidate.location ?? location.city ?? ""),
    linkedin: String(candidate.linkedin ?? ""),
    portfolioUrl: String(candidate.portfolio_url ?? ""),
    github: String(candidate.github ?? ""),
  };
  const resumes = resumeLibrary();
  const reusable = reusableAnswers(standardAnswers, profile);
  return {
    userId: persistedProfile.userId,
    profileScope: persistedProfile.profileScope,
    version: persistedProfile.version,
    snapshotHash: profileHash(persistedProfile),
    contact,
    employmentHistory: parseEmploymentHistory(cv),
    education: parseEducation(cv),
    portfolio: parsePortfolio(profile, cv),
    preferredRoles: [...asStringList(targetRoles.primary), ...asStringList(targetRoles.secondary)],
    salaryTarget: String(compensation.target_range ?? ""),
    geographicPreferences: String(compensation.location_flexibility ?? location.onsite_availability ?? ""),
    standardAnswers,
    reusableAnswers: reusable,
    verification: profileVerification(contact, reusable, resumes),
    resumeVariants: [String(asRecord(profile?.cv).output_format ?? "html")].filter(Boolean),
    resumeLibrary: resumes,
    companyAnswerPacks: readCompanyAnswerPacks(persistedProfile.userId, persistedProfile.profileScope),
    dreamCompanies: companyPrioritiesFromProfile(profile).filter((priority) => priority.tier != null),
    excludedRoleTypes: [
      "Junior / entry-level",
      "Commission-only",
      "Clearance-required",
      "Research Scientist / Applied Scientist",
      "PhD-heavy ML research",
      "Low-level ML infrastructure",
    ],
  };
}

const OUTREACH_PLANS: Array<{
  suffix: string;
  targetType: Outreach["targetType"];
  targetName: string;
  approvalRequired: Outreach["approvalRequired"];
}> = [
  {
    suffix: "hiring-manager",
    targetType: "hiring_manager",
    targetName: "Likely hiring manager not identified yet",
    approvalRequired: "send_hiring_manager_message",
  },
  {
    suffix: "recruiter",
    targetType: "recruiter",
    targetName: "Recruiter not identified yet",
    approvalRequired: "send_recruiter_message",
  },
  {
    suffix: "linkedin-dm",
    targetType: "linkedin_dm",
    targetName: "LinkedIn contact not identified yet",
    approvalRequired: "send_recruiter_message",
  },
  {
    suffix: "cold-dm",
    targetType: "cold_dm",
    targetName: "Cold outreach target not identified yet",
    approvalRequired: "send_recruiter_message",
  },
  {
    suffix: "follow-up",
    targetType: "follow_up",
    targetName: "Follow-up recipient not identified yet",
    approvalRequired: "send_recruiter_message",
  },
  {
    suffix: "application-follow-up",
    targetType: "application_follow_up",
    targetName: "Application follow-up recipient not identified yet",
    approvalRequired: "send_recruiter_message",
  },
];

function outreachFromJobs(jobs: Job[]): Outreach[] {
  return jobs.slice(0, 8).flatMap((job) =>
    OUTREACH_PLANS.map((plan) => ({
      id: `${job.id}-${plan.suffix}`,
      jobId: job.id,
      company: job.company,
      role: job.title,
      targetType: plan.targetType,
      targetName: plan.targetName,
      status: "not_connected" as const,
      approvalRequired: plan.approvalRequired,
    })),
  );
}

function auditEvents(): AuditEvent[] {
  const raw = readText("data/hawkeye/audit.jsonl");
  const packageRaw = readText("data/application-packages/package-audit.jsonl");
  const events: AuditEvent[] = [];
  if (raw) {
    events.push(...raw.split("\n").slice(-20).flatMap((line) => {
    if (!line.trim()) return [];
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      return [{
        timestamp: String(parsed.timestamp ?? ""),
        type: String(parsed.type ?? parsed.event ?? "audit"),
        actor: parsed.actor == null ? undefined : String(parsed.actor),
        targetId: parsed.job_id == null ? undefined : String(parsed.job_id),
        summary: String(parsed.reason ?? parsed.action ?? parsed.type ?? "Hawkeye event"),
      }];
    } catch {
      return [];
    }
    }));
  }
  if (packageRaw) {
    events.push(...packageRaw.split("\n").slice(-20).flatMap((line) => {
      if (!line.trim()) return [];
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        return [{
          timestamp: String(parsed.ts ?? ""),
          type: String(parsed.type ?? "application_package_audit"),
          targetId: String(parsed.packageId ?? "unknown"),
          summary: "Application package was isolated for operator review.",
        }];
      } catch {
        return [];
      }
    }));
  }
  return events.slice(-40);
}

function approvalsFromPackagesAndOutreach(packages: ApplicationPackage[], outreach: Outreach[]): Approval[] {
  const approvals: Approval[] = [];
  for (const pkg of packages) {
    if (pkg.status === "PREPARING") {
      approvals.push({ type: "prepare_application", status: "required", targetId: pkg.jobId });
    }
    if (pkg.status === "READY_FOR_REVIEW") {
      approvals.push({ type: "submit_application", status: "required", targetId: pkg.jobId });
    }
    if (pkg.status === "APPROVED") {
      approvals.push({ type: "submit_application", status: "approved", targetId: pkg.jobId });
    }
  }
  for (const item of outreach) {
    approvals.push({
      type: item.approvalRequired,
      status: item.status === "draft_ready" ? "required" : item.status === "approved" || item.status === "sent" ? "approved" : "not_requested",
      targetId: item.id,
    });
  }
  if (!approvals.some((approval) => approval.type === "send_recruiter_message")) {
    approvals.push({ type: "send_recruiter_message", status: "not_requested" });
  }
  if (!approvals.some((approval) => approval.type === "send_hiring_manager_message")) {
    approvals.push({ type: "send_hiring_manager_message", status: "not_requested" });
  }
  return approvals;
}

export function commandCenterData(): CommandCenterData {
  const profile = readProfileYaml();
  const profileData = profileView(profile);
  const jobs = mergeJobs();
  const packages = readApplicationPackages().sort((a, b) => {
    const order: Record<ApplicationPackage["status"], number> = {
      READY_FOR_REVIEW: 0,
      USER_INTERVENTION_REQUIRED: 1,
      PREPARING: 2,
      APPROVED: 3,
      SUBMITTING: 4,
      SUBMITTED: 5,
      FAILED: 6,
      INTERVIEW: 7,
      QUALIFIED: 8,
      EVALUATING: 9,
      DISCOVERED: 10,
      REJECTED: 11,
      CLOSED: 12,
    };
    return order[a.status] - order[b.status] || a.company.localeCompare(b.company);
  });
  const applications = trackerApplications(jobs, packages);
  const outreach = outreachFromJobs(jobs);
  return {
    jobs,
    applications,
    applicationPackages: packages,
    outreach,
    approvals: approvalsFromPackagesAndOutreach(packages, outreach),
    auditEvents: auditEvents(),
    profile: profileData,
  };
}

export function findCommandCenterJob(id: string): Job | null {
  return commandCenterData().jobs.find((job) => job.id === id) ?? null;
}

export function findCommandCenterPackage(id: string): ApplicationPackage | null {
  return findApplicationPackage(id);
}
