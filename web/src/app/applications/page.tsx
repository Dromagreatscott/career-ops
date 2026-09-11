import { commandCenterData } from "@/lib/command-center/service";
import { ApplicationPipeline } from "@/components/command-center/application-pipeline";

export const dynamic = "force-dynamic";

export default function ApplicationsPage() {
  const { applications, jobs, applicationPackages, approvals } = commandCenterData();
  const discovered = jobs
    .filter((job) => !job.trackerNumber)
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
  return <ApplicationPipeline applications={[...applications, ...discovered]} applicationPackages={applicationPackages} approvals={approvals} />;
}
