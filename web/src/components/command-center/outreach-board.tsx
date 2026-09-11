import { MessageSquare, ShieldCheck } from "lucide-react";
import type { Outreach } from "@/lib/command-center/types";

const LABELS: Record<Outreach["targetType"], string> = {
  hiring_manager: "Hiring manager",
  recruiter: "Recruiter",
  linkedin_dm: "LinkedIn DM",
  cold_dm: "Cold outreach",
  follow_up: "Follow-up",
  application_follow_up: "Application follow-up",
};

export function OutreachBoard({ outreach }: { outreach: Outreach[] }) {
  return (
    <div className="mx-auto max-w-5xl px-5 py-6 max-sm:pb-24 sm:px-6 sm:py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-landing">Outreach</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Draft and approval queue for recruiters, hiring managers, LinkedIn DMs, cold outreach, and follow-ups. Sending is not connected in this phase.
        </p>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {outreach.length ? outreach.map((item) => (
          <article key={item.id} className="rounded-xl border border-border bg-surface/45 p-4">
            <div className="flex items-start gap-3">
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand-text">
                <MessageSquare className="size-5" />
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-foreground">{LABELS[item.targetType]}</h2>
                <p className="mt-0.5 text-sm text-muted">{item.company}{item.role ? ` - ${item.role}` : ""}</p>
              </div>
            </div>
            <div className="mt-4 rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted">
              {item.status === "not_connected" ? "Not yet connected. No message will be sent." : item.status}
            </div>
            <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-faint">
              <ShieldCheck className="size-3.5" /> Approval required: {item.approvalRequired.replaceAll("_", " ")}
            </p>
          </article>
        )) : (
          <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted">No outreach targets yet.</div>
        )}
      </div>
    </div>
  );
}
