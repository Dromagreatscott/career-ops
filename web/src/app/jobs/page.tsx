import { commandCenterData } from "@/lib/command-center/service";
import { JobCard } from "@/components/command-center/job-card";

export const dynamic = "force-dynamic";

export default function JobsPage() {
  const { jobs } = commandCenterData();
  const visible = jobs.slice(0, 80);

  return (
    <div className="mx-auto max-w-5xl px-5 py-6 max-sm:pb-24 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-landing">Jobs</h1>
          <p className="mt-1 text-sm text-muted">
            Best current opportunities from Career Ops and Hawkeye. <span className="tabular-nums">{visible.length}</span> shown.
          </p>
        </div>
        <div className="rounded-md border border-border bg-surface/50 px-3 py-2 text-xs text-muted">
          Role-first scoring plus company-first Tier 1 overrides
        </div>
      </div>

      <div className="mt-5 grid gap-3">
        {visible.length ? visible.map((job) => <JobCard key={job.id} job={job} />) : (
          <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted">
            No jobs found. Run `npm run scan` or add URLs to `data/pipeline.md`.
          </div>
        )}
      </div>
    </div>
  );
}
