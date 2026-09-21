import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";
import type { ProfileField, VerificationState } from "./types";

export type ProfileSection = Record<string, ProfileField<string | string[] | boolean>>;

export type ProfileRecord = {
  userId: string;
  profileScope: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  personal: ProfileSection;
  workAuthorization: ProfileSection;
  targeting: ProfileSection;
  compensation: ProfileSection;
  workPreferences: ProfileSection;
  workHistory: ProfileSection;
  education: ProfileSection;
  leadership: ProfileSection;
  aiTechnicalExperience: ProfileSection;
  portfolioProjects: ProfileSection;
};

export type ProfilePatch = Partial<Omit<ProfileRecord, "userId" | "profileScope" | "version" | "createdAt" | "updatedAt">>;

const STORE_REL = "data/web/profile.json";
const STATES = new Set<VerificationState>(["verified", "needs_review", "missing"]);
const SECTION_KEYS = [
  "personal",
  "workAuthorization",
  "targeting",
  "compensation",
  "workPreferences",
  "workHistory",
  "education",
  "leadership",
  "aiTechnicalExperience",
  "portfolioProjects",
] as const;

function nowIso(): string {
  return new Date().toISOString();
}

function storePath(): string {
  return path.join(careerOpsRoot(), STORE_REL);
}

function emptyField<T extends string | string[] | boolean>(value: T): ProfileField<T> {
  return { value, verificationState: value === "" || (Array.isArray(value) && value.length === 0) ? "missing" : "needs_review" };
}

export function emptyProfileRecord(userId: string, profileScope: string): ProfileRecord {
  const now = nowIso();
  return {
    userId,
    profileScope,
    version: 1,
    createdAt: now,
    updatedAt: now,
    personal: {
      name: emptyField(""),
      email: emptyField(""),
      phone: emptyField(""),
      location: emptyField(""),
      linkedin: emptyField(""),
      github: emptyField(""),
      portfolioUrls: emptyField<string[]>([]),
    },
    workAuthorization: {
      authorizedInUs: emptyField(""),
      sponsorshipNow: emptyField(""),
      sponsorshipFuture: emptyField(""),
    },
    targeting: {
      primaryRoles: emptyField<string[]>([]),
      acceptableRoleFamilies: emptyField<string[]>([]),
      dreamCompanies: emptyField<string[]>([]),
    },
    compensation: {
      screeningFloor: emptyField(""),
      preferredCompensation: emptyField(""),
      onsiteThresholdRules: emptyField(""),
    },
    workPreferences: {
      remote: emptyField(""),
      hybrid: emptyField(""),
      onsite: emptyField(""),
      commuteLocation: emptyField(""),
      relocation: emptyField(""),
      travel: emptyField(""),
      availability: emptyField(""),
    },
    workHistory: { summary: emptyField("") },
    education: { summary: emptyField("") },
    leadership: { summary: emptyField("") },
    aiTechnicalExperience: { summary: emptyField("") },
    portfolioProjects: { summary: emptyField("") },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeField(current: ProfileField<string | string[] | boolean> | undefined, incoming: unknown): ProfileField<string | string[] | boolean> | undefined {
  if (!isRecord(incoming)) return undefined;
  const rawValue = incoming.value;
  if (typeof rawValue !== "string" && typeof rawValue !== "boolean" && !Array.isArray(rawValue)) return undefined;
  if (Array.isArray(rawValue) && !rawValue.every((item) => typeof item === "string")) return undefined;
  const verificationState = STATES.has(incoming.verificationState as VerificationState)
    ? incoming.verificationState as VerificationState
    : current?.verificationState ?? (rawValue === "" || (Array.isArray(rawValue) && rawValue.length === 0) ? "missing" : "needs_review");
  return {
    value: Array.isArray(rawValue) ? rawValue.map((item) => item.trim()).filter(Boolean) : rawValue,
    verificationState,
    updatedAt: nowIso(),
  };
}

function mergeSection(current: ProfileSection, patch: unknown): ProfileSection {
  if (!isRecord(patch)) return current;
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    const normalized = normalizeField(current[key], value);
    if (normalized) next[key] = normalized;
  }
  return next;
}

/**
 * Material profile content used for hashing — deterministic across reads. Strips ALL
 * timestamps (top-level createdAt/updatedAt and per-field updatedAt) so the hash is a
 * pure function of identity + version + field values/verification. Without this a
 * synthesized (canonical-only) profile would hash differently every read (fresh
 * createdAt), making the package snapshot and approval-invalidation checks unstable.
 */
function hashableProfile(profile: ProfileRecord): unknown {
  const out: Record<string, unknown> = {
    userId: profile.userId,
    profileScope: profile.profileScope,
    version: profile.version,
  };
  for (const section of SECTION_KEYS) {
    const source = isRecord(profile[section]) ? (profile[section] as ProfileSection) : {};
    const fields: Record<string, { value: unknown; verificationState: VerificationState }> = {};
    for (const [key, field] of Object.entries(source)) {
      if (isRecord(field)) {
        fields[key] = {
          value: (field as ProfileField<string | string[] | boolean>).value,
          verificationState: (field as ProfileField<string | string[] | boolean>).verificationState,
        };
      }
    }
    out[section] = fields;
  }
  return out;
}

export function profileHash(profile: ProfileRecord): string {
  return crypto.createHash("sha256").update(JSON.stringify(hashableProfile(profile))).digest("hex");
}

const CONFIG_PROFILE_REL = "config/profile.yml";

// No volatile updatedAt: canonical fields must hash identically across reads so the
// resolved profileHash is deterministic (it only changes when config/profile.yml
// changes) — otherwise every read would look like a "material" profile change.
function verifiedField(value: string | string[]): ProfileField<string | string[]> {
  return { value, verificationState: "verified" };
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function fieldHasValue(field: unknown): field is ProfileField<string | string[] | boolean> {
  if (!isRecord(field)) return false;
  const value = (field as { value?: unknown }).value;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === "boolean";
}

/**
 * Canonical identity/contact facts from `config/profile.yml` (candidate.*) — David's
 * own source of truth, the same file the UI reads. Returned as VERIFIED personal
 * fields so the ATS executor can SAFE_AUTOFILL them. Only non-empty values are
 * returned; sensitive sections (compensation, sponsorship, demographic, …) are NOT
 * sourced here, so they stay empty and remain USER_REQUIRED.
 */
function canonicalPersonalFields(): ProfileSection {
  const out: ProfileSection = {};
  let candidate: Record<string, unknown> = {};
  let location: Record<string, unknown> = {};
  try {
    const parsed = yaml.load(fs.readFileSync(path.join(careerOpsRoot(), CONFIG_PROFILE_REL), "utf8"));
    if (isRecord(parsed)) {
      if (isRecord(parsed.candidate)) candidate = parsed.candidate;
      if (isRecord(parsed.location)) location = parsed.location;
    }
  } catch {
    return out;
  }
  const loc = nonEmptyString(candidate.location) ? candidate.location : nonEmptyString(location.city) ? (location.city as string) : undefined;
  if (nonEmptyString(candidate.full_name)) out.name = verifiedField(candidate.full_name.trim());
  if (nonEmptyString(candidate.email)) out.email = verifiedField(candidate.email.trim());
  if (nonEmptyString(candidate.phone)) out.phone = verifiedField(candidate.phone.trim());
  if (nonEmptyString(loc)) out.location = verifiedField(loc.trim());
  if (nonEmptyString(candidate.linkedin)) out.linkedin = verifiedField(candidate.linkedin.trim());
  if (nonEmptyString(candidate.github)) out.github = verifiedField(candidate.github.trim());
  if (nonEmptyString(candidate.portfolio_url)) out.portfolioUrls = verifiedField([candidate.portfolio_url.trim()]);
  return out;
}

function readPersistedProfileRecord(): ProfileRecord | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), "utf8")) as ProfileRecord;
    if (parsed.userId && parsed.profileScope) return parsed;
  } catch {
    /* no persisted profile */
  }
  return null;
}

/**
 * Canonical profile resolution (single source of truth for BOTH the ATS executor
 * and the package snapshot/hash):
 *
 *   resolved = empty
 *            + canonical config/profile.yml identity (verified)
 *            + persisted data/web/profile.json overrides (field-by-field, where the
 *              persisted field carries a value; its verificationState is preserved)
 *
 * So a missing data/web/profile.json no longer yields an empty executor profile when
 * valid canonical facts exist, while the UI, package builder, and executor all see
 * the same resolved data — keeping profileHash / approval-invalidation consistent.
 */
export function readProfileRecord(userId = "career-ops-operator", profileScope = "career-ops"): ProfileRecord {
  const persisted = readPersistedProfileRecord();
  const base = emptyProfileRecord(persisted?.userId ?? userId, persisted?.profileScope ?? profileScope);
  base.personal = { ...base.personal, ...canonicalPersonalFields() };
  if (!persisted) return base;

  const merged: ProfileRecord = {
    ...base,
    userId: persisted.userId,
    profileScope: persisted.profileScope,
    version: typeof persisted.version === "number" ? persisted.version : base.version,
    createdAt: persisted.createdAt ?? base.createdAt,
    updatedAt: persisted.updatedAt ?? base.updatedAt,
  };
  for (const section of SECTION_KEYS) {
    const out: ProfileSection = { ...base[section] };
    const persistedSection = isRecord(persisted[section]) ? (persisted[section] as ProfileSection) : {};
    for (const [key, field] of Object.entries(persistedSection)) {
      if (fieldHasValue(field)) out[key] = field; // persisted value overrides canonical
      else if (!(key in out) && isRecord(field)) out[key] = field as ProfileField<string | string[] | boolean>;
    }
    merged[section] = out;
  }
  return merged;
}

export function writeProfileRecord(profile: ProfileRecord): ProfileRecord {
  atomicWriteWithBackup(storePath(), `${JSON.stringify(profile, null, 2)}\n`);
  return profile;
}

export function updateProfileRecord(userId: string, profileScope: string, patch: ProfilePatch): ProfileRecord {
  const current = readProfileRecord(userId, profileScope);
  const now = nowIso();
  const next: ProfileRecord = {
    ...current,
    userId,
    profileScope,
    version: current.version + 1,
    updatedAt: now,
    personal: mergeSection(current.personal, patch.personal),
    workAuthorization: mergeSection(current.workAuthorization, patch.workAuthorization),
    targeting: mergeSection(current.targeting, patch.targeting),
    compensation: mergeSection(current.compensation, patch.compensation),
    workPreferences: mergeSection(current.workPreferences, patch.workPreferences),
    workHistory: mergeSection(current.workHistory, patch.workHistory),
    education: mergeSection(current.education, patch.education),
    leadership: mergeSection(current.leadership, patch.leadership),
    aiTechnicalExperience: mergeSection(current.aiTechnicalExperience, patch.aiTechnicalExperience),
    portfolioProjects: mergeSection(current.portfolioProjects, patch.portfolioProjects),
  };
  return writeProfileRecord(next);
}

export function materialProfileFields(profile: ProfileRecord): string[] {
  const fields: string[] = [];
  for (const [sectionName, section] of Object.entries(profile)) {
    if (!isRecord(section) || sectionName === "userId") continue;
    for (const [fieldName, field] of Object.entries(section)) {
      if (isRecord(field) && field.verificationState !== "missing") fields.push(`${sectionName}.${fieldName}`);
    }
  }
  return fields;
}
