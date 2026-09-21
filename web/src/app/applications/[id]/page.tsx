import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2, ExternalLink, FileText, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { commandCenterData, findCommandCenterPackage } from "@/lib/command-center/service";
import { readApplicationSessions } from "@/lib/command-center/application-sessions";
import { executionReadiness } from "@/lib/command-center/execution-readiness";
import type { ApplicationPackage, ApplicationSession, QuestionClassification, VerificationState } from "@/lib/command-center/types";
import { PackageDecisionActions } from "@/components/command-center/package-decision-actions";
import { ResumeOverrideActions } from "@/components/command-center/resume-override-actions";
import { PackageExecutionActions } from "@/components/command-center/package-execution-actions";
import { EditQuestionActions } from "@/components/command-center/edit-question-actions";

export const dynamic = "force-dynamic";

export default async function ApplicationReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pkg = findCommandCenterPackage(id);
  if (!pkg) return notFound();
  const data = commandCenterData();
  const profile = data.profile;
  const applicationPackage = pkg;
  const completeQuestions = applicationPackage.questions.filter((question) => question.classification !== "USER_REQUIRED").length;
  const warnings = warningsForPackage(applicationPackage);
  const verifiedProfileItems = profile.verification.filter((item) => item.status === "verified").length;
  const sessions = readApplicationSessions()
    .filter((session) => session.applicationPackageId === applicationPackage.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const latestSession = sessions[0];
  const readiness = executionReadiness(applicationPackage);

  return (
    <div className="mx-auto max-w-5xl px-5 py-6 max-sm:pb-24 sm:px-6 sm:py-8">
      <Link href="/applications" className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-brand">
        <ArrowLeft className="size-4" /> Applications
      </Link>

      <header className="mt-5 rounded-xl border border-border bg-surface/55 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Application Review</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-landing">{applicationPackage.company}</h1>
            <p className="mt-1 text-base text-foreground">{applicationPackage.title}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={applicationPackage.status === "APPROVED" ? "good" : applicationPackage.status === "REJECTED" ? "bad" : "warn"}>{formatStatus(applicationPackage.status)}</Badge>
            <Badge tone="muted">{applicationPackage.atsType}</Badge>
            <Badge tone={applicationPackage.compensationStatus === "comp_exception_low_priority" ? "bad" : applicationPackage.compensationStatus === "preferred" ? "good" : "muted"}>
              {formatStatus(applicationPackage.compensationStatus)}
            </Badge>
          </div>
        </div>
      </header>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1.35fr_.75fr]">
        <main className="space-y-4">
          <section className="rounded-xl border border-border bg-surface/45 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">Role Summary</h2>
            <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
              <ReviewRow label="Company" value={applicationPackage.company} />
              <ReviewRow label="Role" value={applicationPackage.title} />
              <ReviewRow label="ATS" value={applicationPackage.atsType} />
              <ReviewRow label="Fit" value={applicationPackage.baseRoleFit == null ? "Not scored" : `${applicationPackage.baseRoleFit}/5`} />
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              {applicationPackage.canonicalApplyUrl ? (
                <a href={applicationPackage.canonicalApplyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline">
                  <ExternalLink className="size-4" /> Open official job
                </a>
              ) : null}
              {applicationPackage.reportHref ? (
                <Link href={applicationPackage.reportHref} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline">
                  <FileText className="size-4" /> Evaluation report
                </Link>
              ) : null}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-surface/45 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">Fit Analysis</h2>
            <ul className="mt-3 space-y-2">
              {applicationPackage.roleFitExplanation.length ? applicationPackage.roleFitExplanation.map((item) => (
                <li key={item} className="rounded-md bg-background/45 px-3 py-2 text-sm leading-relaxed text-muted">{item}</li>
              )) : (
                <li className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted">Fit explanation is pending Career Ops evaluation.</li>
              )}
            </ul>
          </section>

          <section className="rounded-xl border border-border bg-surface/45 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">Resume</h2>
            <div className="mt-3 rounded-md bg-background/45 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-foreground">{applicationPackage.selectedResume.label}</p>
                  <p className="mt-1 text-xs text-muted">{applicationPackage.selectedResume.path || "Resume file pending"}</p>
                  {applicationPackage.selectedResume.recommendationReason ? (
                    <p className="mt-1 text-xs text-faint">{applicationPackage.selectedResume.recommendationReason}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge tone={applicationPackage.selectedResume.status === "ready" ? "good" : "warn"}>{applicationPackage.selectedResume.status}</Badge>
                  <Badge tone={applicationPackage.selectedResume.selection === "override" ? "warn" : "muted"}>
                    {applicationPackage.selectedResume.selection ?? "recommended"}
                  </Badge>
                </div>
              </div>
              <div className="mt-3 space-y-1.5 text-sm text-muted">
                {applicationPackage.tailoredResumeChanges.map((change) => <p key={change}>{change}</p>)}
              </div>
              <ResumeOverrideActions
                packageId={applicationPackage.id}
                packageHash={applicationPackage.packageHash}
                version={applicationPackage.version}
                selectedResumeId={applicationPackage.selectedResume.id}
                resumes={profile.resumeLibrary}
              />
            </div>
          </section>

          <section className="rounded-xl border border-border bg-surface/45 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">Reusable Answers</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {profile.reusableAnswers.map((answer) => (
                <div key={answer.id} className="rounded-md bg-background/45 px-3 py-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-foreground">{answer.label}</div>
                      <p className="mt-1 text-sm text-muted">{answer.value || "-"}</p>
                    </div>
                    <VerificationPill status={answer.verification} />
                  </div>
                  <p className="mt-2 text-xs text-faint">{answer.safeToAutofill ? "Safe autofill" : "Review before use"}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-surface/45 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">Application Questions</h2>
            <div className="mt-3 space-y-3">
              {applicationPackage.questions.map((question) => (
                <article key={question.id} className="rounded-lg border border-border bg-background/45 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="text-sm font-medium text-foreground">{question.label}</h3>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {question.source === "ats" ? <Badge tone="muted">ATS discovered</Badge> : null}
                      <QuestionBadge classification={question.classification} />
                    </div>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{question.value || question.draft || "No answer yet."}</p>
                  <p className="mt-2 text-xs text-faint">{question.explanation}</p>
                  <EditQuestionActions
                    packageId={applicationPackage.id}
                    packageHash={applicationPackage.packageHash}
                    version={applicationPackage.version}
                    question={question}
                  />
                </article>
              ))}
            </div>
          </section>
        </main>

        <aside className="space-y-4">
          <section className="rounded-xl border border-border bg-surface/45 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">Final Check</h2>
            <div className="mt-4 space-y-3 text-sm">
              <CheckLine label="Destination" value={applicationPackage.atsType} complete={applicationPackage.atsType !== "unknown"} />
              <CheckLine label="Profile" value={`${verifiedProfileItems} / ${profile.verification.length} verified`} complete={profile.verification.every((item) => item.status !== "missing")} />
              <CheckLine label="Resume" value={applicationPackage.selectedResume.label} complete={applicationPackage.selectedResume.status === "ready"} />
              <CheckLine label="Questions" value={`${completeQuestions} / ${applicationPackage.questions.length} complete`} complete={completeQuestions === applicationPackage.questions.length} />
              <CheckLine label="Warnings" value={warnings.length ? `${warnings.length}` : "None"} complete={!warnings.length} />
            </div>
            {warnings.length ? (
              <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
                <div className="mb-1 flex items-center gap-1.5 font-medium"><AlertTriangle className="size-4" /> Review needed</div>
                {warnings.map((warning) => <p key={warning}>{warning}</p>)}
              </div>
            ) : null}
          </section>

          <section className="rounded-xl border border-border bg-surface/45 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">Execution Readiness</h2>
            <div className="mt-4 space-y-3 text-sm">
              <CheckLine label="ATS" value={readiness.ats} complete={readiness.ats === "SUPPORTED"} />
              <CheckLine label="Application URL" value={readiness.url} complete={readiness.url === "VALID"} />
              <CheckLine label="Resume" value={readiness.resume} complete={readiness.resume === "READY"} />
              <CheckLine label="Profile" value={readiness.profile} complete={readiness.profile === "READY"} />
              <CheckLine label="Answers" value={readiness.answers} complete={readiness.answers === "AUTO-FILL READY"} />
              <CheckLine label="Package" value="CURRENT" complete />
              <CheckLine label="Approval" value={readiness.approval} complete={readiness.approval === "VALID"} />
            </div>
            {readiness.warnings.length ? (
              <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
                {readiness.warnings.map((warning) => <p key={warning}>{warning}</p>)}
              </div>
            ) : null}
          </section>

          <section className="rounded-xl border border-border bg-surface/45 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">Profile Verification</h2>
            <div className="mt-3 space-y-2">
              {profile.verification.map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-3 rounded-md bg-background/45 px-3 py-2">
                  <div>
                    <div className="text-sm font-medium text-foreground">{item.label}</div>
                    <div className="mt-0.5 text-xs text-muted">{item.detail || item.source}</div>
                  </div>
                  <VerificationPill status={item.status} />
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-surface/45 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">Approval</h2>
            <p className="mt-3 break-all rounded-md bg-background/45 px-3 py-2 text-xs text-faint">Hash: {applicationPackage.packageHash}</p>
            <div className="mt-4">
              <PackageDecisionActions
                packageId={applicationPackage.id}
                packageHash={applicationPackage.packageHash}
                version={applicationPackage.version}
                status={applicationPackage.status}
              />
            </div>
          </section>

          <section className="rounded-xl border border-border bg-surface/45 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">Submit Executor</h2>
            <div className="mt-3 flex items-start gap-2 rounded-md bg-background/45 p-3 text-sm text-muted">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" />
              Greenhouse / Lever / Ashby / Workday execution is package-gated; an unknown ATS uses generic manual assist. Dry run always stops before final submit.
            </div>
            <div className="mt-4">
              <PackageExecutionActions
                packageId={applicationPackage.id}
                packageHash={applicationPackage.packageHash}
                version={applicationPackage.version}
                canSubmit={readiness.readyForLive}
                resumableSessionId={latestSession?.status === "USER_INTERVENTION_REQUIRED" ? latestSession.id : undefined}
              />
            </div>
            {latestSession ? <ExecutionSessionSummary session={latestSession} /> : null}
          </section>
        </aside>
      </div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-md bg-background/45 px-3 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-faint">{label}</dt>
      <dd className="mt-1 text-foreground">{value || "-"}</dd>
    </div>
  );
}

function CheckLine({ label, value, complete }: { label: string; value: string; complete: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/60 pb-2 last:border-0">
      <span className="text-muted">{label}</span>
      <span className="flex items-center gap-1.5 text-right text-foreground">
        <CheckCircle2 className={complete ? "size-4 text-emerald-600 dark:text-emerald-400" : "size-4 text-amber-600 dark:text-amber-400"} />
        {value}
      </span>
    </div>
  );
}

function QuestionBadge({ classification }: { classification: QuestionClassification }) {
  if (classification === "SAFE_AUTOFILL") return <Badge tone="good">Autofill</Badge>;
  if (classification === "REVIEW_REQUIRED") return <Badge tone="warn">Review</Badge>;
  return <Badge tone="bad">Needs David</Badge>;
}

function VerificationPill({ status }: { status: VerificationState }) {
  if (status === "verified") return <Badge tone="good">verified</Badge>;
  if (status === "needs_review") return <Badge tone="warn">review</Badge>;
  return <Badge tone="bad">missing</Badge>;
}

function warningsForPackage(pkg: ApplicationPackage): string[] {
  return [
    pkg.atsType === "unknown" ? "ATS is not supported yet; this package can be reviewed but not executed." : "",
    pkg.selectedResume.status !== "ready" ? "Selected resume file is pending." : "",
    pkg.questions.some((question) => question.classification === "USER_REQUIRED") ? "At least one answer needs David before submission." : "",
  ].filter(Boolean);
}

function ExecutionSessionSummary({ session }: { session: ApplicationSession }) {
  const needsDavid = session.status === "USER_INTERVENTION_REQUIRED";
  return (
    <div className="mt-4 rounded-md bg-background/45 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-foreground">{session.mode === "DRY_RUN" ? "Dry run" : "Live session"}</span>
        <Badge tone={needsDavid ? "warn" : session.status === "SUBMITTED" ? "good" : session.status === "FAILED" ? "bad" : "muted"}>
          {session.status === "USER_INTERVENTION_REQUIRED" ? "NEEDS DAVID" : formatStatus(session.status)}
        </Badge>
      </div>
      {needsDavid ? (
        <p className="mt-2 text-xs leading-relaxed text-amber-800 dark:text-amber-300">{session.userActionMessage || session.lastErrorCode}</p>
      ) : null}
      {session.status === "SUBMITTED" ? (
        <div className="mt-2 space-y-1 text-xs text-muted">
          <p>{session.submittedAt}</p>
          {session.confirmationId ? <p>Confirmation: {session.confirmationId}</p> : null}
          {session.confirmationSummary ? <p>{session.confirmationSummary}</p> : null}
          {session.confirmationUrl ? <a href={session.confirmationUrl} target="_blank" rel="noreferrer" className="text-brand hover:underline">Open confirmation</a> : null}
        </div>
      ) : null}
      {session.dryRunReport ? (
        <div className="mt-3 grid gap-1 text-xs text-muted">
          <p>Fields found: {session.dryRunReport.fieldsFound}</p>
          <p>Safe autofill: {session.dryRunReport.safeAutofill.length}</p>
          <p>Needs review: {session.dryRunReport.reviewRequired.length}</p>
          <p>Needs you: {session.dryRunReport.userRequired.length}</p>
          <p>Ready for live: {session.dryRunReport.readyForLiveSubmission ? "yes" : "no"}</p>
        </div>
      ) : null}
    </div>
  );
}

function formatStatus(value: string): string {
  return value.toLowerCase().replaceAll("_", " ");
}
