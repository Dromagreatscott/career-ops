"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import type { ResumeLibraryItem } from "@/lib/command-center/types";
import { cn } from "@/lib/cn";

type State = "idle" | "saving" | "saved" | "stale" | "error";

export function ResumeOverrideActions({
  packageId,
  packageHash,
  version,
  selectedResumeId,
  resumes,
}: {
  packageId: string;
  packageHash: string;
  version: number;
  selectedResumeId?: string;
  resumes: ResumeLibraryItem[];
}) {
  const router = useRouter();
  const [resumeId, setResumeId] = useState(selectedResumeId ?? "");
  const [state, setState] = useState<State>("idle");
  const readyResumes = resumes.filter((resume) => resume.status === "ready");
  const unchanged = resumeId === (selectedResumeId ?? "");

  async function saveOverride() {
    if (!resumeId || unchanged) return;
    setState("saving");
    try {
      const res = await fetch(`/api/applications/packages/${packageId}/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageHash, version, resumeId }),
      });
      if (res.status === 409) {
        setState("stale");
        return;
      }
      if (!res.ok) throw new Error("resume override failed");
      setState("saved");
      router.refresh();
    } catch {
      setState("error");
    }
  }

  return (
    <div className="mt-3 space-y-2">
      <label className="block text-xs font-semibold uppercase tracking-wide text-faint" htmlFor="resume-override">
        Resume override
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <select
          id="resume-override"
          value={resumeId}
          onChange={(event) => {
            setResumeId(event.target.value);
            setState("idle");
          }}
          className="min-h-10 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
        >
          {readyResumes.map((resume) => (
            <option key={resume.id} value={resume.id}>
              {resume.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={saveOverride}
          disabled={!resumeId || unchanged || state === "saving"}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition hover:border-brand/40 hover:text-brand disabled:opacity-60"
        >
          <RefreshCw className="size-4" /> {state === "saving" ? "Saving" : "Use resume"}
        </button>
      </div>
      <p
        className={cn(
          "rounded-md px-3 py-2 text-xs leading-relaxed",
          state === "error" || state === "stale"
            ? "border border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300"
            : "bg-surface/60 text-faint",
        )}
      >
        {state === "stale"
          ? "This package changed after the screen loaded. Reload before changing the resume."
          : state === "error"
            ? "Resume override was not saved. Try again."
            : state === "saved"
              ? "Resume override saved. Review the refreshed package before approval."
              : "Changing the resume updates the package hash and resets review if needed."}
      </p>
    </div>
  );
}
