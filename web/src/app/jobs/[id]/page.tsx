import { notFound } from "next/navigation";
import { findCommandCenterJob } from "@/lib/command-center/service";
import { JobDetail } from "@/components/command-center/job-detail";

export const dynamic = "force-dynamic";

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = findCommandCenterJob(id);
  if (!job) notFound();
  return <JobDetail job={job as NonNullable<typeof job>} />;
}
