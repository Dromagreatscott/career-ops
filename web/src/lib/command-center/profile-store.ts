import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
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

export function profileHash(profile: ProfileRecord): string {
  const { updatedAt: _updatedAt, ...hashable } = profile;
  return crypto.createHash("sha256").update(JSON.stringify(hashable)).digest("hex");
}

export function readProfileRecord(userId = "career-ops-operator", profileScope = "career-ops"): ProfileRecord {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), "utf8")) as ProfileRecord;
    if (parsed.userId && parsed.profileScope) return parsed;
  } catch {
    /* fall through */
  }
  return emptyProfileRecord(userId, profileScope);
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
