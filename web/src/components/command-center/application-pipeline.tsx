import Link from "next/link";
import { Columns3, ShieldCheck, Table2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CompanyLogo } from "@/components/company-logo";
import { scoreTone } from "@/lib/format";
import type { Application, ApplicationPackage, ApplicationStage, Approval } from "@/lib/command-center/types";

const STAGES: ApplicationStage[] = [
  "Discovered",
  "Evaluating",
  "Qualified",
  "Preparing",
  "Ready for Review",
  "Approved",
  "Submitted",
  "Interview",
  "Rejected",
  "Closed",
  "Withdrawn",
];

export function ApplicationPipeline({
  applications,
  applicationPackages = [],
  approvals = [],
}: {
  applications: Application[];
  applicationPackages?: ApplicationPackage[];
  approvals?: Approval[];
}) {
  const grouped = new Map<ApplicationStage, Application[]>();
  for (const stage of STAGES) grouped.set(stage, []);
  for (const app of applications) grouped.get(app.stage)?.push(app);
  const ready = applicationPackages.filter((pkg) => pkg.status === "ready_for_review" || pkg.status === "approved");
  const requiredApprovals = approvals.filter((approval) => approval.status === "required");

  return (
    <div className="mx-auto max-w-7xl px-5 py-6 max-sm:pb-24 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-landing">Applications</h1>
          <p className="mt-1 text-sm text-muted">Tracker-backed pipeline. No submission happens from this screen.</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-faint">
          <Columns3 className="size-4" /> mobile cards
          <span className="hidden sm:inline-flex items-center gap-1"><Table2 className="size-4" /> desktop lanes</span>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        <ApprovalStat label="Prepare" count={requiredApprovals.filter((approval) => approval.type === "prepare_application").length} />
        <ApprovalStat label="Submit" count={requiredApprovals.filter((approval) => approval.type === "submit_application").length} />
        <ApprovalStat label="Recruiter" count={requiredApprovals.filter((approval) => approval.type === "send_recruiter_message").length} />
        <ApprovalStat label="Hiring mgr" count={requiredApprovals.filter((approval) => approval.type === "send_hiring_manager_message").length} />
      </div>

      <section className="mt-5 rounded-xl border border-border bg-surface/45 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-muted">
            <ShieldCheck className="size-4 text-brand" /> Review queue
          </h2>
          <span className="rounded-md bg-surface-hover px-2 py-1 text-xs tabular-nums text-muted">{ready.length} ready</span>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          {ready.length ? ready.slice(0, 6).map((pkg) => <PackageCard key={`${pkg.jobId}-${pkg.status}`} pkg={pkg} />) : (
            <div className="rounded-md border border-dashed border-border px-3 py-5 text-sm text-muted md:col-span-3">
              No application packages are ready for review yet. Preparing materials is approval-gated, and submission remains disabled until explicit approval.
            </div>
          )}
        </div>
      </section>

      <div className="mt-5 grid gap-3 md:auto-cols-[minmax(17rem,1fr)] md:grid-flow-col md:overflow-x-auto md:pb-3">
        {STAGES.map((stage) => (
          <section key={stage} className="rounded-xl border border-border bg-surface/40 p-3 md:min-w-72">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">{stage}</h2>
              <span className="rounded-md bg-surface-hover px-1.5 py-0.5 text-xs tabular-nums text-muted">
                {grouped.get(stage)?.length ?? 0}
              </span>
            </div>
            <div className="space-y-2">
              {(grouped.get(stage) ?? []).length ? (
                grouped.get(stage)!.map((app) => <ApplicationCard key={app.id} application={app} />)
              ) : (
                <div className="rounded-md border border-dashed border-border px-3 py-5 text-center text-xs text-faint">No roles</div>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function ApprovalStat({ label, count }: { label: string; count: number }) {
  return (
    <div className="rounded-md border border-border bg-surface/40 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-faint">{label}</div>
      <div className="mt-1 text-sm text-foreground">
        <span className="tabular-nums">{count}</span> required
      </div>
    </div>
  );
}

function ApplicationCard({ application }: { application: Application }) {
  return (
    <article className="rounded-lg border border-border bg-background/45 p-3">
      <div className="flex items-start gap-2.5">
        <CompanyLogo name={application.company} size={28} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium text-foreground">{application.company}</h3>
          <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted">{application.title}</p>
        </div>
        <Badge tone={application.score == null ? "muted" : scoreTone(String(application.score))}>
          {application.scoreLabel || "-"}
        </Badge>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 text-xs text-faint">
        <span>{application.status || application.stage}</span>
        {application.trackerNumber ? <Link href={`/pipeline/${application.trackerNumber}`} className="text-brand hover:underline">Report</Link> : null}
      </div>
      {application.applicationPackage ? (
        <div className="mt-2 rounded-md border border-border/70 bg-surface/45 px-2 py-1.5 text-xs text-muted">
          Package: {formatPackageStatus(application.applicationPackage.status)}
        </div>
      ) : null}
    </article>
  );
}

function PackageCard({ pkg }: { pkg: ApplicationPackage }) {
  return (
    <article className="rounded-md border border-border bg-background/45 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium text-foreground">{pkg.company}</h3>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted">{pkg.title}</p>
        </div>
        <Badge tone={pkg.status === "approved" ? "good" : "warn"}>{formatPackageStatus(pkg.status)}</Badge>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted">{pkg.materialSummary}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        {pkg.reportHref ? <Link href={pkg.reportHref} className="text-brand hover:underline">Report</Link> : null}
        {pkg.canonicalApplyUrl ? <a href={pkg.canonicalApplyUrl} target="_blank" rel="noreferrer" className="text-brand hover:underline">ATS</a> : null}
        <span className="text-faint">Submit approval required</span>
      </div>
    </article>
  );
}

function formatPackageStatus(status: ApplicationPackage["status"]): string {
  return status.replaceAll("_", " ");
}
