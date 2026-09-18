import type { ApplicationPackage, ApplicationQuestion, AtsType } from "./types";
import { validateExternalUrl } from "@/lib/security/url";

export type AtsJobRef = {
  atsType: AtsType;
  companySlug: string;
  jobId: string;
  canonicalUrl: string;
};

export type AtsSession = {
  atsType: AtsType;
  ref: AtsJobRef;
  mode: "review_only";
};

export type FieldResult = {
  fieldId: string;
  status: "ready" | "missing" | "review_required";
  message: string;
};

export type ValidationResult = {
  ok: boolean;
  missing: ApplicationQuestion[];
  warnings: string[];
};

export type PackageApproval = {
  packageId: string;
  packageHash: string;
  approvedAt: string;
};

export type SubmissionResult = {
  status: "disabled" | "submitted";
  confirmationId?: string;
  message: string;
};

export interface AtsAdapter {
  readonly type: AtsType;
  detect(url: URL): boolean;
  normalize(url: URL): AtsJobRef | null;
  createSession(pkg: ApplicationPackage): Promise<AtsSession>;
  autofillSafeFields(session: AtsSession, pkg: ApplicationPackage): Promise<FieldResult[]>;
  uploadResume(session: AtsSession, resumePath: string): Promise<FieldResult>;
  enterApprovedAnswers(session: AtsSession, pkg: ApplicationPackage): Promise<FieldResult[]>;
  identifyMissingFields(session: AtsSession): Promise<ApplicationQuestion[]>;
  validate(session: AtsSession): Promise<ValidationResult>;
  submit(session: AtsSession, approval: PackageApproval): Promise<SubmissionResult>;
}

const SAFE_SLUG = /^[a-zA-Z0-9._-]+$/;

function reviewOnlyAdapter(type: "greenhouse" | "lever", hosts: string[], pathPattern: RegExp): AtsAdapter {
  return {
    type,
    detect(url) {
      return hosts.includes(url.hostname) && pathPattern.test(url.pathname);
    },
    normalize(url) {
      const match = url.pathname.match(pathPattern);
      if (!match || !this.detect(url)) return null;
      const [, companySlug, jobId] = match;
      if (!SAFE_SLUG.test(companySlug) || !SAFE_SLUG.test(jobId)) return null;
      return {
        atsType: type,
        companySlug,
        jobId,
        canonicalUrl: url.toString(),
      };
    },
    async createSession(pkg) {
      const ref = detectAts(pkg.canonicalApplyUrl || pkg.canonicalJobUrl);
      if (!ref || ref.atsType !== type) throw new Error(`Package is not a ${type} application`);
      return { atsType: type, ref, mode: "review_only" };
    },
    async autofillSafeFields(_session, pkg) {
      return pkg.questions
        .filter((question) => question.classification === "SAFE_AUTOFILL")
        .map((question) => ({
          fieldId: question.id,
          status: "ready" as const,
          message: "Prepared from verified profile answer.",
        }));
    },
    async uploadResume(_session, resumePath) {
      return {
        fieldId: "resume",
        status: resumePath ? "ready" : "missing",
        message: resumePath ? "Resume is selected for review-only upload." : "Resume path is not available yet.",
      };
    },
    async enterApprovedAnswers(_session, pkg) {
      return pkg.questions.map((question) => ({
        fieldId: question.id,
        status: question.classification === "USER_REQUIRED" ? "missing" : "ready",
        message: question.classification === "USER_REQUIRED" ? "Needs David before submission." : "Answer prepared.",
      }));
    },
    async identifyMissingFields(_session) {
      return [];
    },
    async validate(_session) {
      return { ok: true, missing: [], warnings: ["External submission is not enabled in this slice."] };
    },
    async submit() {
      return {
        status: "disabled",
        message: "Submission is intentionally disabled until executor automation is connected.",
      };
    },
  };
}

export const GREENHOUSE_ADAPTER = reviewOnlyAdapter(
  "greenhouse",
  ["boards.greenhouse.io", "job-boards.greenhouse.io", "greenhouse.io"],
  /^\/([^/]+)\/jobs\/([a-zA-Z0-9._-]+)/,
);

export const LEVER_ADAPTER = reviewOnlyAdapter(
  "lever",
  ["jobs.lever.co", "jobs.eu.lever.co", "lever.co"],
  /^\/([^/]+)\/([^/?#]+)/,
);

export const ATS_ADAPTERS: AtsAdapter[] = [GREENHOUSE_ADAPTER, LEVER_ADAPTER];

export function detectAts(rawUrl?: string): AtsJobRef | null {
  if (!rawUrl) return null;
  const parsed = validateExternalUrl(rawUrl);
  if (!parsed.ok) return null;
  for (const adapter of ATS_ADAPTERS) {
    const ref = adapter.normalize(parsed.parsed);
    if (ref) return ref;
  }
  return null;
}
