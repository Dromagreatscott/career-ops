import { commandCenterData } from "@/lib/command-center/service";
import { ApplicationPipeline } from "@/components/command-center/application-pipeline";
import type { ApplicationStage } from "@/lib/command-center/types";

export const dynamic = "force-dynamic";

export default function ApplicationsPage() {
  const { applications, jobs, applicationPackages, approvals } = commandCenterData();
  const packagedJobIds = new Set(applicationPackages.map((pkg) => pkg.jobId));
  const packageApplications = applicationPackages.map((pkg) => ({
    id: `pkg-${pkg.id}`,
    jobId: pkg.jobId,
    trackerNumber: pkg.trackerNumber,
    company: pkg.company,
    title: pkg.title,
    stage: stageFromPackageStatus(pkg.status),
    status: pkg.status,
    score: pkg.baseRoleFit,
    scoreLabel: pkg.baseRoleFit == null ? "TBD" : `${pkg.baseRoleFit}/5`,
    canonicalApplyUrl: pkg.canonicalApplyUrl,
    sourceUrl: pkg.canonicalJobUrl,
    reportHref: pkg.reportHref,
    applicationPackage: pkg,
  }));
  const discovered = jobs
    .filter((job) => !job.trackerNumber && !packagedJobIds.has(job.id))
    .map((job) => ({
      id: `job-${job.id}`,
      jobId: job.id,
      company: job.company,
      title: job.title,
      stage: job.stage,
      status: job.stage,
      score: job.fitScore,
      scoreLabel: job.fitScore == null ? "TBD" : `${job.fitScore}/5`,
      canonicalApplyUrl: job.canonicalApplyUrl,
      sourceUrl: job.sourceUrl,
      applicationPackage: applicationPackages.find((pkg) => pkg.jobId === job.id),
    }));
  return <ApplicationPipeline applications={[...packageApplications, ...applications, ...discovered]} applicationPackages={applicationPackages} approvals={approvals} />;
}

function stageFromPackageStatus(status: string): ApplicationStage {
  if (status === "READY_FOR_REVIEW") return "Ready for Review";
  if (status === "APPROVED") return "Approved";
  if (status === "SUBMITTING") return "Submitting";
  if (status === "SUBMITTED") return "Submitted";
  if (status === "USER_INTERVENTION_REQUIRED") return "Needs David";
  if (status === "INTERVIEW") return "Interview";
  if (status === "CLOSED") return "Closed";
  if (status === "REJECTED") return "Rejected";
  if (status === "PREPARING") return "Preparing";
  if (status === "QUALIFIED") return "Qualified";
  if (status === "EVALUATING") return "Evaluating";
  return "Discovered";
}
