import path from "node:path";
import fs from "node:fs";
import { careerOpsRoot } from "@/lib/career-ops";
import { openSession, fillSession } from "@/lib/apply/session";
import { readResumeLibrary, resumeFilePath } from "../resume-library";
import { mapPackageFields, dryRunReport } from "./field-mapping";
import type { ApplicationPackage, AtsType } from "../types";
import type { AtsExecutionAdapter, ExecutionBlocker, ExecutionContext, InspectedApplication } from "./types";

function approvedResumeFile(pkg: ApplicationPackage): { status: "READY" | "MISSING" | "VERSION_MISMATCH"; file?: string; blocker?: ExecutionBlocker } {
  const resumeId = pkg.selectedResume.id;
  const version = pkg.selectedResume.version ?? 1;
  if (!resumeId) return { status: "MISSING", blocker: { code: "MISSING_RESUME", message: "No approved resume ID is attached to this package.", action: "Select a resume and rebuild the package." } };
  const library = readResumeLibrary(pkg.userId, pkg.profileScope, true);
  const resume = library.find((item) => item.id === resumeId);
  if (resume) {
    if ((resume.version ?? 1) !== version) {
      return { status: "VERSION_MISMATCH", blocker: { code: "RESUME_VERSION_MISMATCH", message: "The selected resume version no longer matches the approved package.", action: "Re-review the package with the current resume version." } };
    }
    const file = resumeFilePath(resume);
    if (file && fs.existsSync(file)) return { status: "READY", file };
  }
  if (pkg.selectedResume.path) {
    const file = path.join(careerOpsRoot(), pkg.selectedResume.path);
    if (fs.existsSync(file)) return { status: "READY", file };
  }
  return { status: "MISSING", blocker: { code: "MISSING_RESUME", message: "The approved resume file is missing.", action: "Upload or restore the exact approved resume version." } };
}

export abstract class BrowserAtsAdapter implements AtsExecutionAdapter {
  abstract readonly type: AtsType;
  abstract detect(url: URL): boolean;

  async startSession(ctx: ExecutionContext): Promise<InspectedApplication> {
    return this.inspectApplication(ctx);
  }

  async inspectApplication(ctx: ExecutionContext): Promise<InspectedApplication> {
    try {
      const opened = await openSession(ctx.session.canonicalUrl, undefined, false, true);
      return {
        title: opened.title,
        url: ctx.session.canonicalUrl,
        applySessionId: opened.id,
        fields: opened.fields,
        issues: opened.issues.map((issue) => ({ code: issue.code, message: issue.message, level: issue.level })),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not open application form.";
      return { title: ctx.pkg.title, url: ctx.session.canonicalUrl, fields: [], issues: [{ code: "NETWORK_FAILURE", message, level: "block" }] };
    }
  }

  async mapFields(ctx: ExecutionContext, inspected: InspectedApplication) {
    return mapPackageFields(inspected.fields, ctx.pkg);
  }

  async uploadResume(ctx: ExecutionContext) {
    const resume = approvedResumeFile(ctx.pkg);
    return resume.blocker ?? null;
  }

  async fillFields(ctx: ExecutionContext, inspected: InspectedApplication, mappings = mapPackageFields(inspected.fields, ctx.pkg)): Promise<ExecutionBlocker[]> {
    if (!ctx.dryRunFill || !inspected.applySessionId) return [];
    const resume = approvedResumeFile(ctx.pkg);
    const answers = Object.fromEntries(
      mappings
        .filter((mapping) => mapping.status === "mapped" && mapping.value && mapping.classification !== "USER_REQUIRED")
        .map((mapping) => [mapping.field.id, mapping.value!]),
    );
    const fillable = mappings.map((mapping) => mapping.field);
    try {
      const result = await fillSession(inspected.applySessionId, answers, fillable, resume.file);
      return result.issues.map((issue) => ({ code: "UNEXPECTED_ATS_STRUCTURE", message: issue.message, action: "Review the field in the live form." }));
    } catch {
      return [{ code: "UNEXPECTED_ATS_STRUCTURE", message: "Career Ops could not fill the inspected form reliably.", action: "Open the ATS form and review manually." }];
    }
  }

  async validate(ctx: ExecutionContext, inspected: InspectedApplication, mappings = mapPackageFields(inspected.fields, ctx.pkg)): Promise<ExecutionBlocker[]> {
    const blockers: ExecutionBlocker[] = [];
    const resume = approvedResumeFile(ctx.pkg);
    if (resume.blocker) blockers.push(resume.blocker);
    for (const issue of inspected.issues) {
      if (/captcha/i.test(issue.code)) blockers.push({ code: "CAPTCHA_REQUIRED", message: issue.message, action: "Complete the CAPTCHA in the browser, then resume." });
      else if (/login|auth/i.test(issue.code)) blockers.push({ code: "LOGIN_REQUIRED", message: issue.message, action: "Log in or continue manually, then resume." });
      else if (issue.level === "block") blockers.push({ code: "UNEXPECTED_ATS_STRUCTURE", message: issue.message, action: "Review the ATS page manually." });
    }
    blockers.push(...mappings.flatMap((mapping) => mapping.blocker ? [mapping.blocker] : []));
    return blockers;
  }

  async submit(): Promise<ExecutionBlocker | null> {
    return { code: "CONFIRMATION_UNVERIFIED", message: "Live final submit is implemented behind approval gate but disabled until David starts a controlled test submission.", action: "Run dry-run first, then explicitly authorize a test live submission." };
  }

  async captureConfirmation() {
    return null;
  }

  report(ctx: ExecutionContext, mappings: ReturnType<typeof mapPackageFields>, blockers: ExecutionBlocker[]) {
    return dryRunReport(this.type, mappings, approvedResumeFile(ctx.pkg).status, blockers);
  }
}
