"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play, Send, RotateCw } from "lucide-react";
import { cn } from "@/lib/cn";

type State = "idle" | "running" | "done" | "error" | "stale";

export function PackageExecutionActions({
  packageId,
  packageHash,
  version,
  canSubmit,
  resumableSessionId,
}: {
  packageId: string;
  packageHash: string;
  version: number;
  canSubmit: boolean;
  resumableSessionId?: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState("Dry run inspects and maps the ATS form without clicking final submit.");

  async function execute(action: "dry-run" | "start-live" | "resume") {
    setState("running");
    try {
      const res = await fetch(`/api/applications/packages/${packageId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, packageHash, version, sessionId: action === "resume" ? resumableSessionId : undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setState("stale");
        setMessage(body.error || "Package changed after approval. Reload and review current package.");
        return;
      }
      if (!res.ok) throw new Error(body.error || "execution failed");
      setState("done");
      const blockers = Array.isArray(body.blockers) ? body.blockers.length : 0;
      setMessage(blockers ? `Execution paused for David: ${body.blockers[0]?.code ?? "review required"}.` : action === "dry-run" ? "Dry run completed without submitting." : "Execution updated.");
      router.refresh();
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Execution failed.");
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => execute("dry-run")}
        disabled={state === "running"}
        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition hover:border-brand/40 hover:text-brand disabled:opacity-60"
      >
        <Play className="size-4" /> {state === "running" ? "Running" : "Dry Run"}
      </button>
      <button
        type="button"
        onClick={() => execute("start-live")}
        disabled={!canSubmit || state === "running"}
        className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-md bg-brand px-4 py-3 text-base font-semibold text-brand-foreground transition hover:bg-brand-200 disabled:opacity-60"
      >
        <Send className="size-5" /> Approve & Submit
      </button>
      {resumableSessionId ? (
        <button
          type="button"
          onClick={() => execute("resume")}
          disabled={state === "running"}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-amber-500/40 px-3 py-2 text-sm font-medium text-amber-800 transition hover:bg-amber-500/10 disabled:opacity-60 dark:text-amber-300"
        >
          <RotateCw className="size-4" /> Resume Application
        </button>
      ) : null}
      <p
        className={cn(
          "rounded-md px-3 py-2 text-xs leading-relaxed",
          state === "error" || state === "stale"
            ? "border border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300"
            : "bg-surface/60 text-faint",
        )}
      >
        {message}
      </p>
    </div>
  );
}
