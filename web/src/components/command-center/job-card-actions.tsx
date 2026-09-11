"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bookmark, ExternalLink, FileCheck2, FileText, X } from "lucide-react";
import { cn } from "@/lib/cn";

type ActionState = "idle" | "saving" | "saved" | "blocked" | "error";

type Props = {
  jobId: string;
  trackerNumber?: string;
  applyHref: string;
  canonicalApplyResolved: boolean;
};

export function JobCardActions({ jobId, trackerNumber, applyHref, canonicalApplyResolved }: Props) {
  const router = useRouter();
  const [skipState, setSkipState] = useState<ActionState>("idle");
  const [saveState, setSaveState] = useState<ActionState>("idle");

  async function updateStatus(status: "SKIP" | "Evaluated", setState: (state: ActionState) => void) {
    if (!trackerNumber) {
      setState("blocked");
      return;
    }
    setState("saving");
    try {
      const res = await fetch("/api/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ n: trackerNumber, status }),
      });
      if (!res.ok) throw new Error("status update failed");
      setState("saved");
      router.refresh();
      window.setTimeout(() => setState("idle"), 1800);
    } catch {
      setState("error");
    }
  }

  const disabledTitle = "Persistent Skip/Save needs a tracker row. This pipeline/Hawkeye item is visible, but writeback is not connected yet.";

  return (
    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
      <button
        type="button"
        onClick={() => updateStatus("SKIP", setSkipState)}
        title={!trackerNumber ? disabledTitle : "Mark this tracker row as SKIP"}
        className={cn(
          "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm transition",
          skipState === "blocked" || skipState === "error"
            ? "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300"
            : "text-muted hover:bg-surface-hover hover:text-foreground",
        )}
      >
        <X className="size-4" /> {buttonLabel("Skip", skipState)}
      </button>
      <button
        type="button"
        onClick={() => updateStatus("Evaluated", setSaveState)}
        title={!trackerNumber ? disabledTitle : "Keep this tracker row in Evaluated status"}
        className={cn(
          "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm transition",
          saveState === "blocked" || saveState === "error"
            ? "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300"
            : "text-muted hover:bg-surface-hover hover:text-foreground",
        )}
      >
        <Bookmark className="size-4" /> {buttonLabel("Save", saveState)}
      </button>
      <Link
        href={`/apply?url=${encodeURIComponent(applyHref)}`}
        className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition hover:border-brand/40 hover:text-brand"
      >
        <FileCheck2 className="size-4" /> Prepare
      </Link>
      <Link
        href={`/jobs/${jobId}`}
        className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition hover:border-brand/40 hover:text-brand"
      >
        <FileText className="size-4" /> Details
      </Link>
      <a
        href={applyHref}
        target="_blank"
        rel="noreferrer"
        className={cn(
          "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition",
          canonicalApplyResolved
            ? "bg-brand text-brand-foreground hover:bg-brand-200"
            : "border border-amber-500/40 bg-amber-500/10 text-amber-800 hover:bg-amber-500/15 dark:text-amber-300",
        )}
      >
        <ExternalLink className="size-4" /> Open ATS
      </a>
    </div>
  );
}

function buttonLabel(label: string, state: ActionState): string {
  if (state === "saving") return "Saving";
  if (state === "saved") return "Saved";
  if (state === "blocked") return "Not connected";
  if (state === "error") return "Try again";
  return label;
}
