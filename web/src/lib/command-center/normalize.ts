import type { ApplicationStage } from "./types";
import { normalizeExternalUrl, validateExternalUrl } from "@/lib/security/url";

export function stableId(prefix: string, value: string): string {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${prefix}-${(h >>> 0).toString(36)}`;
}

export function scoreValue(value: string | number | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const match = String(value ?? "").match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function sourcePlatform(url: string): string {
  const parsed = validateExternalUrl(url);
  const host = parsed.ok ? parsed.parsed.hostname.toLowerCase() : "";
  if (!host) return "Unknown";
  if (host.includes("greenhouse.io")) return "Greenhouse";
  if (host.includes("ashbyhq.com")) return "Ashby";
  if (host.includes("lever.co")) return "Lever";
  if (host.includes("workdayjobs.com") || host.includes("myworkdayjobs.com")) return "Workday";
  if (host.includes("smartrecruiters.com")) return "SmartRecruiters";
  if (host.includes("icims.com")) return "iCIMS";
  if (host.includes("linkedin.com")) return "LinkedIn";
  if (host.includes("indeed.com")) return "Indeed";
  if (host.includes("ziprecruiter.com")) return "ZipRecruiter";
  const root = host.replace(/^www\./, "").split(".").slice(-2).join(".");
  return root || "Employer";
}

export function canonicalApplyUrl(url: string): string | undefined {
  const parsed = validateExternalUrl(url);
  if (!parsed.ok) return undefined;
  const host = parsed.parsed.hostname.toLowerCase();
  if (!host) return undefined;
  const aggregator = /(linkedin|indeed|glassdoor|ziprecruiter|builtin|wellfound|jobright|ihire|jobs-in)\./i;
  if (aggregator.test(host)) return undefined;
  return normalizeExternalUrl(url);
}

export function workArrangementFromText(...values: Array<string | undefined>): string | undefined {
  const text = values.filter(Boolean).join(" ").toLowerCase();
  if (/\bremote\b/.test(text)) return "Remote";
  if (/\bhybrid\b/.test(text)) return "Hybrid";
  if (/\bon[-\s]?site\b|\bin office\b|\bin-person\b/.test(text)) return "On-site";
  return undefined;
}

export function stageFromStatus(status: string | undefined): ApplicationStage {
  const s = String(status ?? "").toLowerCase();
  if (!s || s === "-" || s === "\u2014") return "Discovered";
  if (/ready/.test(s)) return "Ready for Review";
  if (/prepar/.test(s)) return "Preparing";
  if (/approv/.test(s)) return "Approved";
  if (/appl|submit|sent/.test(s)) return "Submitted";
  if (/interview|respond|reply/.test(s)) return "Interview";
  if (/withdraw/.test(s)) return "Withdrawn";
  if (/reject|no|skip/.test(s)) return "Rejected";
  if (/closed|discard|archive|duplicate/.test(s)) return "Closed";
  if (/evaluat|qualif|watch|research/.test(s)) return "Qualified";
  return "Discovered";
}

export function stageFromEvaluation(status: string | undefined, score: number | null): ApplicationStage {
  const s = String(status ?? "").toLowerCase();
  if (/pending/.test(s)) return "Evaluating";
  if (/requires_review/.test(s)) return score != null && score >= 4 ? "Qualified" : "Evaluating";
  if (/complete|evaluated/.test(s)) return score != null && score >= 3.8 ? "Qualified" : "Closed";
  return score != null ? "Qualified" : "Discovered";
}

export function plainSummary(parts: {
  score: number | null;
  recommendation?: string;
  dreamCompany?: boolean;
  title?: string;
  hardMismatches?: string[];
}): string {
  if (parts.hardMismatches?.length) return `Needs caution: ${parts.hardMismatches[0]}.`;
  if (parts.dreamCompany) return "Dream-company opportunity; broader company-first review is enabled.";
  if (parts.score != null && parts.score >= 4.2) return "Strong fit for applied AI leadership and customer-facing architecture.";
  if (parts.score != null && parts.score >= 3.8) return "Promising fit; worth review before preparing an application.";
  if (parts.score != null) return "Fit is mixed; review the evidence before spending application time.";
  if (/\b(applied ai|solutions architect|ai architect|forward deployed|ai transformation|agentic)\b/i.test(parts.title ?? "")) {
    return "Looks aligned on title; Career Ops evaluation is still needed.";
  }
  return "Not scored yet; review the official posting before acting.";
}
