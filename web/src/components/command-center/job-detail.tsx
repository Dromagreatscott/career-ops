import Link from "next/link";
import { ArrowLeft, ExternalLink, ShieldCheck, AlertTriangle, Send, UserCheck } from "lucide-react";
import { CompanyLogo } from "@/components/company-logo";
import { Badge } from "@/components/ui/badge";
import { scoreTone } from "@/lib/format";
import type { Job } from "@/lib/command-center/types";
import { CompanyPriorityBadge } from "./job-card";

export function JobDetail({ job }: { job: Job }) {
  return (
    <div className="mx-auto max-w-4xl px-5 py-6 max-sm:pb-24 sm:px-6 sm:py-8">
      <Link href="/jobs" className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-brand">
        <ArrowLeft className="size-4" /> Jobs
      </Link>

      <section className="mt-5 rounded-xl border border-border bg-surface/55 p-5">
        <div className="flex items-start gap-4">
          <CompanyLogo name={job.company} size={54} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-landing">{job.company}</h1>
              <CompanyPriorityBadge job={job} />
            </div>
            <p className="mt-1 text-lg text-foreground">{job.title}</p>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{job.fitSummary}</p>
          </div>
          <Badge tone={job.fitScore == null ? "muted" : scoreTone(String(job.fitScore))}>
            {job.fitScore == null ? "TBD" : `${job.fitScore}/5`}
          </Badge>
        </div>
      </section>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1.4fr_.8fr]">
        <section className="rounded-xl border border-border bg-surface/45 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">Fit Evidence</h2>
          {job.evaluation?.strongestEvidence.length ? (
            <ul className="mt-3 space-y-2 text-sm text-muted">
              {job.evaluation.strongestEvidence.slice(0, 5).map((item) => (
                <li key={item} className="rounded-md bg-background/45 px-3 py-2">{item}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted">Career Ops evidence is not connected for this posting yet.</p>
          )}

          {job.evaluation?.hardMismatches.length ? (
            <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-red-700 dark:text-red-300">
                <AlertTriangle className="size-4" /> Hard mismatch signals
              </div>
              <ul className="mt-2 space-y-1 text-sm text-muted">
                {job.evaluation.hardMismatches.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          ) : null}
        </section>

        <aside className="space-y-4">
          <section className="rounded-xl border border-border bg-surface/45 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">Posting</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <Row label="Location" value={job.location} />
              <Row label="Work" value={job.workArrangement} />
              <Row label="Comp" value={job.compensation} />
              <Row label="Posted" value={job.postedDate || job.discoveredDate} />
              <Row label="Source" value={job.source} />
              <Row label="Platform" value={job.applicationPlatform} />
              <Row label="Stage" value={job.stage} />
            </dl>
          </section>

          <section className="rounded-xl border border-border bg-surface/45 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">Actions</h2>
            <div className="mt-3 grid gap-2">
              <a
                href={job.canonicalApplyUrl || job.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-md bg-brand px-3 py-2 text-sm font-medium text-brand-foreground transition hover:bg-brand-200"
              >
                <ExternalLink className="size-4" /> Open apply page
              </a>
              <Link
                href={`/apply?url=${encodeURIComponent(job.canonicalApplyUrl || job.sourceUrl)}`}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition hover:border-brand/40 hover:text-brand"
              >
                <ShieldCheck className="size-4" /> Prepare application
              </Link>
              <button className="inline-flex items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted" disabled>
                <Send className="size-4" /> Submit requires approval
              </button>
              <button className="inline-flex items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted" disabled>
                <UserCheck className="size-4" /> Outreach not yet connected
              </button>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-faint">
              Career Ops can prepare materials, but submission and messages remain approval-gated.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border/60 pb-2 last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="max-w-[65%] text-right text-foreground">{value || "-"}</dd>
    </div>
  );
}
