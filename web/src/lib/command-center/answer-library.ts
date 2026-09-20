import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";
import { stableId } from "./normalize";
import type { CompanyAnswerPack, CompanyAnswerPackEntry, QuestionClassification, ReusableApplicationAnswer, VerificationState } from "./types";

type AnswerStore = {
  answers: ReusableApplicationAnswer[];
  packs: CompanyAnswerPack[];
};

const STORE_REL = "data/web/application-answers.json";
const CLASSIFICATIONS = new Set<QuestionClassification>(["SAFE_AUTOFILL", "REVIEW_REQUIRED", "USER_REQUIRED"]);
const VERIFICATION_STATES = new Set<VerificationState>(["verified", "needs_review", "missing"]);
const SENSITIVE_TYPES = new Set(["salary", "compensation", "sponsorship", "work_authorization", "demographic", "eeoc"]);

function nowIso(): string {
  return new Date().toISOString();
}

function storePath(): string {
  return path.join(careerOpsRoot(), STORE_REL);
}

function readStore(): AnswerStore {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), "utf8")) as AnswerStore;
    return {
      answers: Array.isArray(parsed.answers) ? parsed.answers : [],
      packs: Array.isArray(parsed.packs) ? parsed.packs : [],
    };
  } catch {
    return { answers: [], packs: [] };
  }
}

function writeStore(store: AnswerStore): AnswerStore {
  atomicWriteWithBackup(storePath(), `${JSON.stringify(store, null, 2)}\n`);
  return store;
}

function hash(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeClassification(
  prior: QuestionClassification | undefined,
  next: QuestionClassification,
  answerType: string,
  allowSensitiveAutofill = false,
): QuestionClassification {
  if (!CLASSIFICATIONS.has(next)) return prior ?? "REVIEW_REQUIRED";
  if (prior === "USER_REQUIRED" && next === "SAFE_AUTOFILL" && !allowSensitiveAutofill) return "REVIEW_REQUIRED";
  if (SENSITIVE_TYPES.has(answerType.toLowerCase()) && next === "SAFE_AUTOFILL" && !allowSensitiveAutofill) return "REVIEW_REQUIRED";
  return next;
}

function normalizeVerification(value: unknown): VerificationState {
  return VERIFICATION_STATES.has(value as VerificationState) ? value as VerificationState : "needs_review";
}

export function readReusableAnswers(userId?: string, profileScope?: string): ReusableApplicationAnswer[] {
  return readStore().answers.filter((answer) => {
    if (answer.isArchived) return false;
    if (userId && answer.userId !== userId) return false;
    if (profileScope && answer.profileScope !== profileScope) return false;
    return true;
  });
}

export function upsertReusableAnswer(
  input: Partial<ReusableApplicationAnswer> & { title?: string; content?: string; answerType?: string },
  context: { userId: string; profileScope: string; allowSensitiveAutofill?: boolean },
): ReusableApplicationAnswer {
  const store = readStore();
  const existing = input.id ? store.answers.find((answer) => answer.id === input.id) : undefined;
  const now = nowIso();
  const answerType = String(input.answerType ?? existing?.answerType ?? "general").trim() || "general";
  const content = String(input.content ?? input.value ?? existing?.content ?? existing?.value ?? "").trim();
  const classification = normalizeClassification(
    existing?.classification,
    input.classification ?? existing?.classification ?? "REVIEW_REQUIRED",
    answerType,
    context.allowSensitiveAutofill,
  );
  const answer: ReusableApplicationAnswer = {
    id: existing?.id ?? `ans_${stableId("answer", `${context.userId}:${answerType}:${now}`).replace(/^answer-/, "")}`,
    userId: context.userId,
    profileScope: context.profileScope,
    scope: input.scope ?? existing?.scope ?? (input.company ? "company" : "universal"),
    company: input.company ?? existing?.company,
    answerType,
    label: input.label ?? input.title ?? existing?.label ?? answerType.replaceAll("_", " "),
    title: input.title ?? input.label ?? existing?.title ?? answerType.replaceAll("_", " "),
    value: content,
    content,
    category: input.category ?? existing?.category ?? "narrative",
    verification: normalizeVerification(input.verificationState ?? input.verification ?? existing?.verificationState ?? existing?.verification),
    verificationState: normalizeVerification(input.verificationState ?? input.verification ?? existing?.verificationState ?? existing?.verification),
    classification,
    safeToAutofill: classification === "SAFE_AUTOFILL",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastReviewedAt: input.lastReviewedAt ?? existing?.lastReviewedAt,
    isArchived: input.isArchived ?? existing?.isArchived ?? false,
  };
  const index = store.answers.findIndex((item) => item.id === answer.id);
  if (index >= 0) store.answers[index] = answer;
  else store.answers.push(answer);
  writeStore(store);
  return answer;
}

export function archiveReusableAnswer(id: string, context: { userId: string; profileScope: string }): boolean {
  const store = readStore();
  const answer = store.answers.find((item) => item.id === id && item.userId === context.userId && item.profileScope === context.profileScope);
  if (!answer) return false;
  answer.isArchived = true;
  answer.updatedAt = nowIso();
  writeStore(store);
  return true;
}

export function readCompanyAnswerPacks(userId?: string, profileScope?: string): CompanyAnswerPack[] {
  return readStore().packs.filter((pack) => {
    if (pack.isArchived) return false;
    if (userId && pack.userId !== userId) return false;
    if (profileScope && pack.profileScope !== profileScope) return false;
    return true;
  });
}

export function upsertCompanyAnswerPack(
  input: Partial<CompanyAnswerPack> & { company: string },
  context: { userId: string; profileScope: string },
): CompanyAnswerPack {
  const store = readStore();
  const existing = input.id ? store.packs.find((pack) => pack.id === input.id) : undefined;
  const now = nowIso();
  const company = input.company.trim();
  const pack: CompanyAnswerPack = {
    id: existing?.id ?? `pack_${stableId("company", `${context.userId}:${company}`).replace(/^company-/, "")}`,
    userId: context.userId,
    profileScope: context.profileScope,
    company,
    aliases: input.aliases ?? existing?.aliases ?? [],
    entries: input.entries ?? existing?.entries ?? [],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    isArchived: input.isArchived ?? existing?.isArchived ?? false,
  };
  const index = store.packs.findIndex((item) => item.id === pack.id);
  if (index >= 0) store.packs[index] = pack;
  else store.packs.push(pack);
  writeStore(store);
  return pack;
}

export function upsertCompanyAnswerEntry(
  packId: string,
  input: Partial<CompanyAnswerPackEntry> & { answerType: string; title: string; content: string },
  context: { userId: string; profileScope: string; allowSensitiveAutofill?: boolean },
): CompanyAnswerPack | null {
  const store = readStore();
  const pack = store.packs.find((item) => item.id === packId && item.userId === context.userId && item.profileScope === context.profileScope);
  if (!pack) return null;
  const now = nowIso();
  const existing = input.id ? pack.entries.find((entry) => entry.id === input.id) : undefined;
  const entry: CompanyAnswerPackEntry = {
    id: existing?.id ?? `entry_${stableId("entry", `${packId}:${input.answerType}:${now}`).replace(/^entry-/, "")}`,
    answerType: input.answerType,
    title: input.title,
    content: input.content,
    length: input.length ?? existing?.length ?? "medium",
    useCase: input.useCase ?? existing?.useCase,
    classification: normalizeClassification(existing?.classification, input.classification ?? existing?.classification ?? "REVIEW_REQUIRED", input.answerType, context.allowSensitiveAutofill),
    verificationState: normalizeVerification(input.verificationState ?? existing?.verificationState),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastReviewedAt: input.lastReviewedAt ?? existing?.lastReviewedAt,
    isArchived: input.isArchived ?? existing?.isArchived ?? false,
  };
  const index = pack.entries.findIndex((item) => item.id === entry.id);
  if (index >= 0) pack.entries[index] = entry;
  else pack.entries.push(entry);
  pack.updatedAt = now;
  writeStore(store);
  return pack;
}

export function resolveApplicationAnswers(input: {
  userId: string;
  profileScope: string;
  company?: string;
  answerType: string;
}): {
  universal?: ReusableApplicationAnswer;
  company?: CompanyAnswerPackEntry;
  references: Array<{ id: string; hash: string; classification: QuestionClassification; version?: number; packId?: string }>;
} {
  const answers = readReusableAnswers(input.userId, input.profileScope);
  const universal = answers.find((answer) => answer.scope === "universal" && answer.answerType === input.answerType);
  const pack = readCompanyAnswerPacks(input.userId, input.profileScope).find((item) => {
    const names = [item.company, ...item.aliases].map((name) => name.toLowerCase());
    return input.company ? names.includes(input.company.toLowerCase()) : false;
  });
  const company = pack?.entries.find((entry) => !entry.isArchived && entry.answerType === input.answerType);
  const references = [
    universal ? { id: universal.id, hash: hash(universal), classification: universal.classification ?? "REVIEW_REQUIRED" } : null,
    company && pack ? { id: company.id, packId: pack.id, hash: hash(company), classification: company.classification } : null,
  ].filter(Boolean) as Array<{ id: string; hash: string; classification: QuestionClassification; version?: number; packId?: string }>;
  return { universal, company, references };
}

export function answerHash(answer: ReusableApplicationAnswer | CompanyAnswerPackEntry): string {
  return hash(answer);
}
