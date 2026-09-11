import Link from "next/link";
import { Sparkles } from "lucide-react";
import { CompanyLogo } from "@/components/company-logo";
import { Badge } from "@/components/ui/badge";
import { scoreTone } from "@/lib/format";
import type { Job } from "@/lib/command-center/types";
import { JobCardActions } from "./job-card-actions";

export function CompanyPriorityBadge({ job, compact = false }: { job: Job; compact?: boolean }) {
  if (!job.dreamCompany) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-brand/30 bg-brand-soft px-1.5 py-0.5 text-[11px] font-semibold text-brand-text">
      <Sparkles className="size-3" />
      {compact ? "Tier 1" : `Tier ${job.companyPriority.tier} dream company`}
    </span>
  );
}

export function JobCard({ job }: { job: Job }) {
  const applyHref = job.canonicalApplyUrl || job.sourceUrl;
  return (
    <article className="rounded-xl border border-border bg-surface/55 p-4 shadow-sm transition-colors hover:bg-surface/80">
      <div className="flex items-start gap-3">
        <CompanyLogo name={job.company} size={42} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-base font-semibold text-foreground">{job.company}</h2>
            <CompanyPriorityBadge job={job} compact />
          </div>
          <p className="mt-0.5 text-sm leading-snug text-muted">{job.title}</p>
        </div>
        <Badge tone={job.fitScore == null ? "muted" : scoreTone(String(job.fitScore))}>
          {job.fitScore == null ? "TBD" : `${job.fitScore}/5`}
        </Badge>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-muted">{job.fitSummary}</p>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted">
        <Meta label="Location" value={job.location} />
        <Meta label="Work" value={job.workArrangement} />
        <Meta label="Comp" value={job.compensation} />
        <Meta label="Posted" value={job.postedDate || job.discoveredDate} />
        <Meta label="Source" value={job.source} />
        <Meta label="ATS" value={job.applicationPlatform} />
      </dl>

      <div className="mt-3 rounded-md border border-border/70 bg-background/45 px-3 py-2 text-xs text-muted">
        <span className="font-medium text-foreground">Apply URL:</span>{" "}
        {job.canonicalApplyStatus === "resolved" ? (
          <span>{job.applicationPlatform}</span>
        ) : (
          <span className="text-amber-700 dark:text-amber-400">needs official ATS resolution</span>
        )}
      </div>

      <JobCardActions
        jobId={job.id}
        trackerNumber={job.trackerNumber}
        applyHref={applyHref}
        canonicalApplyResolved={job.canonicalApplyStatus === "resolved"}
      />
    </article>
  );
}

function Meta({ label, value }: { label: string; value?: string }) {
  return (
    <div className="min-w-0 rounded-md bg-background/45 px-2.5 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-faint">{label}</dt>
      <dd className="mt-0.5 truncate">{value || "-"}</dd>
    </div>
  );
}
