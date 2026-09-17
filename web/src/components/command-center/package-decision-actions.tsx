"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";

type State = "idle" | "saving" | "done" | "error" | "stale";

export function PackageDecisionActions({ packageId, packageHash, status }: { packageId: string; packageHash: string; status: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>("idle");
  const decided = status === "APPROVED" || status === "REJECTED";

  async function decide(decision: "approved" | "rejected") {
    setState("saving");
    try {
      const res = await fetch(`/api/applications/packages/${packageId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageHash, decision }),
      });
      if (res.status === 409) {
        setState("stale");
        return;
      }
      if (!res.ok) throw new Error("decision failed");
      setState("done");
      router.refresh();
    } catch {
      setState("error");
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => decide("approved")}
        disabled={decided || state === "saving"}
        className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-md bg-brand px-4 py-3 text-base font-semibold text-brand-foreground transition hover:bg-brand-200 disabled:opacity-60"
      >
        <CheckCircle2 className="size-5" /> {decided && status === "APPROVED" ? "Approved" : state === "saving" ? "Saving" : "Approve Package"}
      </button>
      <button
        type="button"
        onClick={() => decide("rejected")}
        disabled={decided || state === "saving"}
        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-muted transition hover:border-red-500/40 hover:text-red-700 disabled:opacity-60 dark:hover:text-red-300"
      >
        <XCircle className="size-4" /> Reject Package
      </button>
      <div
        className={cn(
          "rounded-md px-3 py-2 text-xs leading-relaxed",
          state === "error" || state === "stale"
            ? "border border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300"
            : "bg-surface/60 text-faint",
        )}
      >
        {state === "stale"
          ? "This package changed after the screen loaded. Reload and review the current version before approving."
          : state === "error"
            ? "Decision was not saved. Try again."
            : "Approval is tied to this exact package hash. External submission is not enabled yet."}
      </div>
    </div>
  );
}
