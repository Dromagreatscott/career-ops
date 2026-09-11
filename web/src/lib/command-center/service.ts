import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { careerOpsRoot, readApplications } from "@/lib/career-ops";
import { companyPrioritiesFromProfile, companyPriorityFor } from "./company-priority";
import { canonicalApplyUrl, plainSummary, scoreValue, sourcePlatform, stableId, stageFromEvaluation, stageFromStatus, workArrangementFromText } from "./normalize";
import type { Application, AuditEvent, CommandCenterData, Evaluation, Job, Outreach, ProfileView } from "./types";

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
    if (parts.length < 3 || !/^https?:\/\//i.test(parts[0])) continue;
    const extras = parts.slice(3);
    const entry: PipelineEntry = {
      done: match[1].toLowerCase() === "x",
      url: parts[0],
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
  return (payload.jobs ?? []).map((job) => {
    const company = field(job, "company");
    const title = field(job, "title");
    const sourceUrl = field(job, "source_url");
    const evaluation = evaluationFromHawkeye(job);
    const priority = companyPriorityFor(company, priorities);
    const canonical = canonicalApplyUrl(sourceUrl);
    const score = evaluation?.score ?? null;
    return {
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
    };
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

function trackerApplications(jobs: Job[]): Application[] {
  const byCompanyTitle = new Map<string, Job>();
  for (const job of jobs) byCompanyTitle.set(`${job.company.toLowerCase()}|${job.title.toLowerCase()}`, job);
  return readApplications().map((row) => {
    const match = byCompanyTitle.get(`${row.company.toLowerCase()}|${row.role.toLowerCase()}`);
    const score = scoreValue(row.score);
    const reportMatch = row.report.match(/\(([^)]+)\)/);
    return {
      id: row.n ? `tracker-${row.n}` : stableId("tracker", `${row.company}-${row.role}-${row.date}`),
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
  const candidate = asRecord(profile?.candidate);
  const targetRoles = asRecord(profile?.target_roles);
  const compensation = asRecord(profile?.compensation);
  const location = asRecord(profile?.location);
  const standardAnswers = {
    work_authorization: String(location.visa_status ?? ""),
    onsite_availability: String(location.onsite_availability ?? ""),
    notice_period: String(asRecord(profile?.cover_letter).notice_period_days ?? ""),
  };
  return {
    contact: {
      fullName: String(candidate.full_name ?? ""),
      email: String(candidate.email ?? ""),
      phone: String(candidate.phone ?? ""),
      location: String(candidate.location ?? location.city ?? ""),
      linkedin: String(candidate.linkedin ?? ""),
      portfolioUrl: String(candidate.portfolio_url ?? ""),
      github: String(candidate.github ?? ""),
    },
    preferredRoles: [...asStringList(targetRoles.primary), ...asStringList(targetRoles.secondary)],
    salaryTarget: String(compensation.target_range ?? ""),
    geographicPreferences: String(compensation.location_flexibility ?? location.onsite_availability ?? ""),
    standardAnswers,
    resumeVariants: [String(asRecord(profile?.cv).output_format ?? "html")].filter(Boolean),
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

function outreachFromJobs(jobs: Job[]): Outreach[] {
  return jobs.slice(0, 8).flatMap((job) => [
    {
      id: `${job.id}-recruiter`,
      jobId: job.id,
      company: job.company,
      role: job.title,
      targetType: "recruiter" as const,
      status: "not_connected" as const,
      approvalRequired: "send_recruiter_message" as const,
    },
    {
      id: `${job.id}-manager`,
      jobId: job.id,
      company: job.company,
      role: job.title,
      targetType: "hiring_manager" as const,
      status: "not_connected" as const,
      approvalRequired: "send_hiring_manager_message" as const,
    },
  ]);
}

function auditEvents(): AuditEvent[] {
  const raw = readText("data/hawkeye/audit.jsonl");
  if (!raw) return [];
  return raw.split("\n").slice(-20).flatMap((line) => {
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
  });
}

export function commandCenterData(): CommandCenterData {
  const profile = readProfileYaml();
  const jobs = mergeJobs();
  return {
    jobs,
    applications: trackerApplications(jobs),
    outreach: outreachFromJobs(jobs),
    approvals: [],
    auditEvents: auditEvents(),
    profile: profileView(profile),
  };
}

export function findCommandCenterJob(id: string): Job | null {
  return commandCenterData().jobs.find((job) => job.id === id) ?? null;
}
