"use client";

import { useEffect, useState } from "react";
import { Archive, Check, FileUp, Plus, Save } from "lucide-react";
import type { CompanyAnswerPack, ReusableApplicationAnswer, ResumeLibraryItem, VerificationState } from "@/lib/command-center/types";

type ProfileRecord = Record<string, Record<string, { value: string | string[] | boolean; verificationState: VerificationState }>>;

const states: VerificationState[] = ["verified", "needs_review", "missing"];
const classifications = ["SAFE_AUTOFILL", "REVIEW_REQUIRED", "USER_REQUIRED"] as const;
const categories = ["Applied AI", "AI Strategy / Transformation", "Solutions / Customer Engineering", "Executive / Leadership"];

export function ProfileDataManager() {
  const [profile, setProfile] = useState<ProfileRecord | null>(null);
  const [answers, setAnswers] = useState<ReusableApplicationAnswer[]>([]);
  const [packs, setPacks] = useState<CompanyAnswerPack[]>([]);
  const [resumes, setResumes] = useState<ResumeLibraryItem[]>([]);
  const [saved, setSaved] = useState("");

  async function load() {
    const [profileRes, answersRes, resumesRes] = await Promise.all([
      fetch("/api/profile"),
      fetch("/api/answers"),
      fetch("/api/resumes"),
    ]);
    if (profileRes.ok) setProfile((await profileRes.json()).record);
    if (answersRes.ok) {
      const payload = await answersRes.json();
      setAnswers(payload.answers ?? []);
      setPacks(payload.companyPacks ?? []);
    }
    if (resumesRes.ok) setResumes((await resumesRes.json()).resumes ?? []);
  }

  useEffect(() => {
    load().catch(() => undefined);
  }, []);

  async function saveProfile() {
    if (!profile) return;
    const res = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile }),
    });
    if (res.ok) {
      setSaved("Profile saved");
      await load();
    }
  }

  async function saveAnswer(answer: Partial<ReusableApplicationAnswer>) {
    const res = await fetch("/api/answers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer }),
    });
    if (res.ok) {
      setSaved("Answer saved");
      await load();
    }
  }

  async function savePack(company: string) {
    const res = await fetch("/api/answers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "upsert_pack", pack: { company } }),
    });
    if (res.ok) {
      setSaved("Company pack saved");
      await load();
    }
  }

  async function savePackEntry(packId: string, entry: Record<string, string>) {
    const res = await fetch(`/api/company-answer-packs/${packId}/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entry }),
    });
    if (res.ok) {
      setSaved("Pack entry saved");
      await load();
    }
  }

  async function uploadResume(form: HTMLFormElement, replaceId?: string) {
    const data = new FormData(form);
    const res = await fetch(replaceId ? `/api/resumes/${replaceId}/replace` : "/api/resumes", { method: "POST", body: data });
    if (res.ok) {
      form.reset();
      setSaved(replaceId ? "Resume replaced" : "Resume uploaded");
      await load();
    }
  }

  async function patchResume(id: string, patch: Record<string, unknown>) {
    const res = await fetch(`/api/resumes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      setSaved("Resume updated");
      await load();
    }
  }

  return (
    <section className="mt-5 rounded-xl border border-border bg-surface/45 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">Structured Profile Data</h2>
        {saved ? <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-1 text-xs text-emerald-700 dark:text-emerald-300"><Check className="size-3" /> {saved}</span> : null}
      </div>

      {profile ? (
        <div className="mt-4 space-y-5">
          {Object.entries(profile).filter(([, section]) => section && typeof section === "object").map(([sectionName, section]) => (
            <div key={sectionName}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-faint">{label(sectionName)}</h3>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {Object.entries(section).map(([fieldName, field]) => (
                  <label key={`${sectionName}-${fieldName}`} className="rounded-md border border-border bg-background/45 p-3 text-sm">
                    <span className="block text-xs font-medium text-muted">{label(fieldName)}</span>
                    <textarea
                      value={Array.isArray(field.value) ? field.value.join("\n") : String(field.value ?? "")}
                      onChange={(event) => setProfile((current) => current ? {
                        ...current,
                        [sectionName]: {
                          ...current[sectionName],
                          [fieldName]: { ...field, value: Array.isArray(field.value) ? event.target.value.split("\n").map((item) => item.trim()).filter(Boolean) : event.target.value },
                        },
                      } : current)}
                      className="mt-1 min-h-16 w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
                    />
                    <select
                      value={field.verificationState}
                      onChange={(event) => setProfile((current) => current ? {
                        ...current,
                        [sectionName]: { ...current[sectionName], [fieldName]: { ...field, verificationState: event.target.value as VerificationState } },
                      } : current)}
                      className="mt-2 min-h-9 w-full rounded-md border border-border bg-background px-2 text-xs"
                    >
                      {states.map((state) => <option key={state} value={state}>{state}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          ))}
          <button type="button" onClick={saveProfile} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-brand px-3 py-2 text-sm font-medium text-brand-foreground">
            <Save className="size-4" /> Save profile
          </button>
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <AnswerPanel answers={answers} onSave={saveAnswer} />
        <CompanyPackPanel packs={packs} onCreate={savePack} onEntry={savePackEntry} />
      </div>

      <div className="mt-6">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-faint">Resume operations</h3>
        <form className="mt-2 grid gap-2 rounded-md border border-border bg-background/45 p-3 md:grid-cols-4" onSubmit={(event) => { event.preventDefault(); uploadResume(event.currentTarget); }}>
          <input name="file" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required className="text-sm" />
          <input name="name" placeholder="Name" className="rounded-md border border-border bg-background px-2 py-2 text-sm" />
          <select name="category" className="rounded-md border border-border bg-background px-2 py-2 text-sm">
            {categories.map((category) => <option key={category}>{category}</option>)}
          </select>
          <button className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-brand px-3 py-2 text-sm font-medium text-brand-foreground"><FileUp className="size-4" /> Upload</button>
        </form>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {resumes.map((resume) => (
            <div key={resume.id} className="rounded-md border border-border bg-background/45 p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-foreground">{resume.label}</div>
                  <div className="text-xs text-muted">v{resume.version ?? 1} - {resume.category ?? resume.format}</div>
                </div>
                <a href={`/api/resumes/${resume.id}`} target="_blank" className="text-xs text-brand hover:underline">Preview</a>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => patchResume(resume.id, { isDefault: true })} className="rounded-md border border-border px-2 py-1 text-xs">Set default</button>
                <button type="button" onClick={() => patchResume(resume.id, { isArchived: true })} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs"><Archive className="size-3" /> Archive</button>
              </div>
              <form className="mt-2 flex gap-2" onSubmit={(event) => { event.preventDefault(); uploadResume(event.currentTarget, resume.id); }}>
                <input name="file" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required className="min-w-0 flex-1 text-xs" />
                <button className="rounded-md border border-border px-2 py-1 text-xs">Replace</button>
              </form>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function AnswerPanel({ answers, onSave }: { answers: ReusableApplicationAnswer[]; onSave: (answer: Partial<ReusableApplicationAnswer>) => void }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-faint">Reusable answers</h3>
      <form className="mt-2 space-y-2 rounded-md border border-border bg-background/45 p-3" onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        onSave({
          title: String(data.get("title") ?? ""),
          answerType: String(data.get("answerType") ?? "general"),
          content: String(data.get("content") ?? ""),
          classification: data.get("classification") as ReusableApplicationAnswer["classification"],
          verificationState: data.get("verificationState") as VerificationState,
        });
      }}>
        <input name="title" placeholder="Title" className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm" />
        <input name="answerType" placeholder="Answer type" className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm" />
        <textarea name="content" placeholder="Approved content" className="min-h-20 w-full rounded-md border border-border bg-background px-2 py-2 text-sm" />
        <div className="grid gap-2 sm:grid-cols-2">
          <select name="classification" className="rounded-md border border-border bg-background px-2 py-2 text-sm">{classifications.map((item) => <option key={item}>{item}</option>)}</select>
          <select name="verificationState" className="rounded-md border border-border bg-background px-2 py-2 text-sm">{states.map((item) => <option key={item}>{item}</option>)}</select>
        </div>
        <button className="inline-flex min-h-10 items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"><Plus className="size-4" /> Save answer</button>
      </form>
      <div className="mt-2 space-y-2">{answers.map((answer) => <div key={answer.id} className="rounded-md bg-background/45 px-3 py-2 text-sm">{answer.title ?? answer.label}<div className="text-xs text-muted">{answer.classification}</div></div>)}</div>
    </div>
  );
}

function CompanyPackPanel({ packs, onCreate, onEntry }: { packs: CompanyAnswerPack[]; onCreate: (company: string) => void; onEntry: (packId: string, entry: Record<string, string>) => void }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-faint">Company answer packs</h3>
      <form className="mt-2 flex gap-2" onSubmit={(event) => { event.preventDefault(); onCreate(String(new FormData(event.currentTarget).get("company") ?? "")); }}>
        <input name="company" placeholder="Company" className="min-h-10 flex-1 rounded-md border border-border bg-background px-2 text-sm" />
        <button className="rounded-md border border-border px-3 text-sm">Create</button>
      </form>
      <div className="mt-2 space-y-2">
        {packs.map((pack) => (
          <form key={pack.id} className="rounded-md border border-border bg-background/45 p-3 text-sm" onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            onEntry(pack.id, {
              answerType: String(data.get("answerType") ?? ""),
              title: String(data.get("title") ?? ""),
              content: String(data.get("content") ?? ""),
              classification: String(data.get("classification") ?? "REVIEW_REQUIRED"),
              verificationState: String(data.get("verificationState") ?? "needs_review"),
              length: String(data.get("length") ?? "medium"),
            });
          }}>
            <div className="font-medium text-foreground">{pack.company}</div>
            <div className="mt-1 text-xs text-muted">{pack.entries.length} entries</div>
            <input name="title" placeholder="Entry title" className="mt-2 w-full rounded-md border border-border bg-background px-2 py-2 text-sm" />
            <input name="answerType" placeholder="why_company, cover_letter_base..." className="mt-2 w-full rounded-md border border-border bg-background px-2 py-2 text-sm" />
            <textarea name="content" placeholder="Approved company-specific content" className="mt-2 min-h-16 w-full rounded-md border border-border bg-background px-2 py-2 text-sm" />
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <select name="classification" className="rounded-md border border-border bg-background px-2 py-2 text-sm">{classifications.map((item) => <option key={item}>{item}</option>)}</select>
              <select name="verificationState" className="rounded-md border border-border bg-background px-2 py-2 text-sm">{states.map((item) => <option key={item}>{item}</option>)}</select>
              <select name="length" className="rounded-md border border-border bg-background px-2 py-2 text-sm"><option>short</option><option>medium</option><option>long</option></select>
            </div>
            <button className="mt-2 rounded-md border border-border px-3 py-2 text-sm">Save entry</button>
          </form>
        ))}
      </div>
    </div>
  );
}

function label(value: string): string {
  return value.replace(/([A-Z])/g, " $1").replaceAll("_", " ").trim();
}
