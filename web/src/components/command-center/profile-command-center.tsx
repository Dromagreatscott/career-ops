import Link from "next/link";
import { AlertTriangle, BriefcaseBusiness, CheckCircle2, FileText, GraduationCap, LinkIcon, MapPin, Pencil, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import type { ProfileView, VerificationState } from "@/lib/command-center/types";
import { safeExternalHref } from "@/lib/security/url";
import { ProfileDataManager } from "./profile-data-manager";

export function ProfileCommandCenter({ profile }: { profile: ProfileView }) {
  return (
    <div className="mx-auto max-w-5xl px-5 py-6 max-sm:pb-24 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-landing">Profile</h1>
          <p className="mt-1 text-sm text-muted">Canonical career profile read from `config/profile.yml` and existing Career Ops user-layer files.</p>
        </div>
        <Link href="/config" className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition hover:border-brand/40 hover:text-brand">
          <Pencil className="size-4" /> Edit basics
        </Link>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[.9fr_1.1fr]">
        <section className="rounded-xl border border-border bg-surface/45 p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-muted">
            <UserRound className="size-4 text-brand" /> Contact
          </h2>
          <dl className="mt-3 space-y-2 text-sm">
            <Row label="Name" value={profile.contact.fullName} />
            <Row label="Email" value={profile.contact.email} />
            <Row label="Phone" value={profile.contact.phone} />
            <Row label="Location" value={profile.contact.location} />
            <Row label="LinkedIn" value={profile.contact.linkedin} />
            <Row label="Portfolio" value={profile.contact.portfolioUrl} />
            <Row label="GitHub" value={profile.contact.github} />
          </dl>
        </section>

        <section className="rounded-xl border border-border bg-surface/45 p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-muted">
            <BriefcaseBusiness className="size-4 text-brand" /> Preferred roles
          </h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {profile.preferredRoles.map((role) => (
              <span key={role} className="rounded-md bg-surface-hover px-2 py-1 text-xs text-muted">{role}</span>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-surface/45 p-5 lg:col-span-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-muted">
            <BriefcaseBusiness className="size-4 text-brand" /> Employment history
          </h2>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {profile.employmentHistory.length ? profile.employmentHistory.map((item) => (
              <article key={`${item.organization}-${item.title ?? ""}`} className="rounded-md border border-border bg-background/40 p-3">
                <div className="text-sm font-medium text-foreground">{item.organization}</div>
                <div className="mt-1 text-xs text-muted">{[item.title, item.dates].filter(Boolean).join(" - ")}</div>
                {item.location ? <div className="mt-1 text-xs text-faint">{item.location}</div> : null}
                {item.highlights.length ? (
                  <ul className="mt-3 space-y-1 text-xs leading-relaxed text-muted">
                    {item.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}
                  </ul>
                ) : null}
              </article>
            )) : (
              <div className="rounded-md border border-dashed border-border px-3 py-5 text-sm text-muted">Employment history is not connected yet.</div>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-surface/45 p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-muted">
            <GraduationCap className="size-4 text-brand" /> Education
          </h2>
          <div className="mt-3 space-y-2">
            {profile.education.length ? profile.education.map((item) => (
              <div key={`${item.label}-${item.details ?? ""}`} className="rounded-md bg-background/45 px-3 py-2 text-sm">
                <div className="text-foreground">{item.label}</div>
                {item.details ? <div className="mt-0.5 text-xs text-muted">{item.details}</div> : null}
              </div>
            )) : (
              <div className="rounded-md border border-dashed border-border px-3 py-5 text-sm text-muted">Education is not connected yet.</div>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-surface/45 p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-muted">
            <LinkIcon className="size-4 text-brand" /> Portfolio
          </h2>
          <div className="mt-3 space-y-2">
            {profile.portfolio.length ? profile.portfolio.map((item) => {
              const href = safeExternalHref(item.startsWith("http") ? item : `https://${item}`);
              return href ? (
                <a key={item} href={href} target="_blank" rel="noreferrer" className="block truncate rounded-md bg-background/45 px-3 py-2 text-sm text-brand-text hover:underline">
                  {item}
                </a>
              ) : null;
            }) : (
              <div className="rounded-md border border-dashed border-border px-3 py-5 text-sm text-muted">Portfolio links are not connected yet.</div>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-surface/45 p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-muted">
            <MapPin className="size-4 text-brand" /> Targets
          </h2>
          <dl className="mt-3 space-y-2 text-sm">
            <Row label="Salary" value={profile.salaryTarget} />
            <Row label="Geography" value={profile.geographicPreferences} />
            <Row label="Resume variants" value={profile.resumeVariants.join(", ")} />
          </dl>
        </section>

        <section className="rounded-xl border border-border bg-surface/45 p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-muted">
            <CheckCircle2 className="size-4 text-brand" /> Verification
          </h2>
          <div className="mt-3 space-y-2">
            {profile.verification.map((item) => (
              <div key={item.id} className="rounded-md bg-background/45 px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-foreground">{item.label}</div>
                    <div className="mt-0.5 text-xs text-muted">{item.detail || item.source}</div>
                  </div>
                  <VerificationBadge status={item.status} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-surface/45 p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-muted">
            <Sparkles className="size-4 text-brand" /> Dream companies
          </h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {profile.dreamCompanies.map((company) => (
              <div key={company.company} className="rounded-md border border-brand/25 bg-brand-soft px-3 py-2">
                <div className="text-sm font-medium text-foreground">{company.company}</div>
                <div className="mt-1 text-xs text-muted">
                  tier {company.tier ?? "-"} - {company.scoring_mode.replace("_", "-")} - override {company.override_enabled ? "on" : "off"}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-surface/45 p-5 lg:col-span-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-muted">
            <ShieldCheck className="size-4 text-brand" /> Guardrails and standard answers
          </h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-faint">Reusable answers</h3>
              <div className="mt-2 space-y-2">
                {profile.reusableAnswers.map((answer) => (
                  <div key={answer.id} className="rounded-md bg-background/45 px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium text-foreground">{answer.label}</div>
                      <VerificationBadge status={answer.verification} />
                    </div>
                    <p className="mt-1 text-sm text-muted">{answer.value || "-"}</p>
                    <p className="mt-1 text-xs text-faint">{answer.safeToAutofill ? "Safe autofill" : "Review before use"}</p>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-faint">Excluded role types</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {profile.excludedRoleTypes.map((item) => (
                  <span key={item} className="rounded-md bg-surface-hover px-2 py-1 text-xs text-muted">{item}</span>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-surface/45 p-5 lg:col-span-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-muted">
            <FileText className="size-4 text-brand" /> Resume Library
          </h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {profile.resumeLibrary.map((resume) => (
              <article key={resume.id} className="rounded-md border border-border bg-background/45 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-foreground">{resume.label}</div>
                    <div className="mt-1 text-xs text-muted">{resume.path}</div>
                  </div>
                  <span className="rounded-md bg-surface-hover px-2 py-1 text-xs text-muted">{resume.isDefault ? "default" : resume.format}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {resume.recommendedFor.map((item) => (
                    <span key={item} className="rounded-md bg-surface-hover px-2 py-1 text-xs text-muted">{item}</span>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 text-xs text-faint">
                  <span>{resume.updatedAt ? `Updated ${new Date(resume.updatedAt).toLocaleDateString()}` : "No timestamp"}</span>
                  <VerificationBadge status={resume.status === "ready" ? "verified" : "missing"} />
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
      <ProfileDataManager />
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border/60 pb-2 last:border-0">
      <dt className="capitalize text-muted">{label}</dt>
      <dd className="max-w-[62%] text-right text-foreground">{value || "-"}</dd>
    </div>
  );
}

function VerificationBadge({ status }: { status: VerificationState }) {
  const classes =
    status === "verified"
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : status === "needs_review"
        ? "bg-amber-500/10 text-amber-800 dark:text-amber-300"
        : "bg-red-500/10 text-red-700 dark:text-red-300";
  const Icon = status === "verified" ? CheckCircle2 : AlertTriangle;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${classes}`}>
      <Icon className="size-3.5" /> {status.replace("_", " ")}
    </span>
  );
}
