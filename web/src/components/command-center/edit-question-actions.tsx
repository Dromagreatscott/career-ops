"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import type { ApplicationQuestion } from "@/lib/command-center/types";
import { cn } from "@/lib/cn";

type State = "idle" | "saving" | "stale" | "error";

/**
 * Inline answer editor for one application question. Reuses the canonical package
 * question persistence via POST /api/applications/packages/[id]/questions.
 *
 * SAFE_AUTOFILL stays read-only (those come from the verified profile). REVIEW_REQUIRED
 * and USER_REQUIRED open an editor; USER_REQUIRED requires an explicit non-empty answer
 * (the server resolves it to REVIEW_REQUIRED — never SAFE_AUTOFILL). Save persists and
 * refreshes; Cancel restores the prior answer with no write.
 */
export function EditQuestionActions({
  packageId,
  packageHash,
  version,
  question,
}: {
  packageId: string;
  packageHash: string;
  version: number;
  question: ApplicationQuestion;
}) {
  const router = useRouter();
  const prior = question.value ?? question.draft ?? "";
  const editable = question.classification !== "SAFE_AUTOFILL";
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState(prior);
  const [state, setState] = useState<State>("idle");

  if (!editable) {
    return <p className="mt-3 text-xs text-faint">Autofilled from your verified profile — edit it on the Profile page.</p>;
  }

  const needsDavid = question.classification === "USER_REQUIRED";

  async function save() {
    const trimmed = answer.trim();
    if (!trimmed) {
      setState("error");
      return;
    }
    setState("saving");
    try {
      const res = await fetch(`/api/applications/packages/${packageId}/questions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageHash, version, questionId: question.id, answer: trimmed }),
      });
      if (res.status === 409) {
        setState("stale");
        return;
      }
      if (!res.ok) throw new Error("save failed");
      setOpen(false);
      setState("idle");
      router.refresh();
    } catch {
      setState("error");
    }
  }

  function cancel() {
    setAnswer(prior);
    setState("idle");
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setAnswer(prior);
          setState("idle");
          setOpen(true);
        }}
        className={cn(
          "mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition",
          needsDavid
            ? "border-amber-500/50 text-amber-700 hover:border-amber-500 dark:text-amber-300"
            : "border-border text-foreground hover:border-brand/40 hover:text-brand",
        )}
      >
        <Pencil className="size-3.5" /> {needsDavid ? "Answer (needs you)" : "Edit answer"}
      </button>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      <textarea
        value={answer}
        onChange={(event) => {
          setAnswer(event.target.value);
          setState("idle");
        }}
        rows={3}
        autoFocus
        aria-label={`Answer for: ${question.label}`}
        placeholder={needsDavid ? "Your explicit answer is required for this sensitive field." : "Edit the approved answer."}
        className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-brand/50 focus:ring-2 focus:ring-brand/20"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={state === "saving" || !answer.trim()}
          className="inline-flex min-h-9 items-center justify-center rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground transition hover:bg-brand-200 disabled:opacity-60"
        >
          {state === "saving" ? "Saving" : "Save"}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={state === "saving"}
          className="inline-flex min-h-9 items-center justify-center rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted transition hover:text-foreground disabled:opacity-60"
        >
          Cancel
        </button>
        {needsDavid ? <span className="text-xs text-faint">Explicit answer required — never auto-filled.</span> : null}
      </div>
      {state === "stale" || state === "error" ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
          {state === "stale"
            ? "This package changed after the screen loaded. Reload before editing this answer."
            : "Answer was not saved. Provide a value and try again."}
        </p>
      ) : null}
    </div>
  );
}
