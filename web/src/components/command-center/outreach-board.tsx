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

const ORDER: Outreach["targetType"][] = [
  "hiring_manager",
  "recruiter",
  "linkedin_dm",
  "cold_dm",
  "follow_up",
  "application_follow_up",
];

export function OutreachBoard({ outreach }: { outreach: Outreach[] }) {
  const grouped = new Map<Outreach["targetType"], Outreach[]>();
  for (const item of outreach) {
    grouped.set(item.targetType, [...(grouped.get(item.targetType) ?? []), item]);
  }

  return (
    <div className="mx-auto max-w-5xl px-5 py-6 max-sm:pb-24 sm:px-6 sm:py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-landing">Outreach</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Draft and approval queue for recruiters, hiring managers, LinkedIn DMs, cold outreach, and follow-ups. Sending is not connected in this phase.
        </p>
      </div>

      {outreach.length ? (
        <div className="mt-5 space-y-5">
          {ORDER.flatMap((type) => {
            const items = grouped.get(type) ?? [];
            if (!items.length) return [];
            return (
              <section key={type} aria-labelledby={`outreach-${type}`}>
                <div className="flex items-center justify-between gap-3">
                  <h2 id={`outreach-${type}`} className="text-sm font-semibold text-foreground">{LABELS[type]}</h2>
                  <span className="rounded-md border border-border px-2 py-1 text-xs text-muted">{items.length} planned</span>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {items.map((item) => (
                    <article key={item.id} className="rounded-lg border border-border bg-surface/45 p-4">
                      <div className="flex items-start gap-3">
                        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand-text">
                          <MessageSquare className="size-5" />
                        </span>
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold text-foreground">{item.company}</h3>
                          <p className="mt-0.5 text-sm text-muted">{item.role}</p>
                        </div>
                      </div>
                      <div className="mt-4 rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted">
                        <p>{item.targetName || "Target not identified yet"}</p>
                        <p className="mt-1">
                          {item.status === "not_connected" ? "Not yet connected. No message will be sent." : item.status}
                        </p>
                      </div>
                      <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-faint">
                        <ShieldCheck className="size-3.5" /> Approval required: {item.approvalRequired.replaceAll("_", " ")}
                      </p>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="mt-5 rounded-lg border border-dashed border-border px-6 py-12 text-center text-sm text-muted">No outreach targets yet.</div>
      )}
    </div>
  );
}
