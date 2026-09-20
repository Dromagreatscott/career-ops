import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";
import type { ResumeLibraryItem } from "./types";

export const RESUME_CATEGORIES = [
  "Applied AI",
  "AI Strategy / Transformation",
  "Solutions / Customer Engineering",
  "Executive / Leadership",
] as const;

type ResumeStore = {
  resumes: ResumeLibraryItem[];
};

export type ResumeUploadInput = {
  userId: string;
  profileScope: string;
  originalFilename: string;
  contentType: string;
  bytes: Buffer;
  name?: string;
  category?: string;
  notes?: string;
};

const STORE_REL = "data/web/resumes/metadata.json";
const FILES_REL = "data/web/resumes/files";
const MAX_RESUME_BYTES = 5 * 1024 * 1024;
const ALLOWED = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

function nowIso(): string {
  return new Date().toISOString();
}

function storePath(): string {
  return path.join(careerOpsRoot(), STORE_REL);
}

function filesDir(): string {
  return path.join(careerOpsRoot(), FILES_REL);
}

function readStore(): ResumeStore {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), "utf8")) as ResumeStore;
    return { resumes: Array.isArray(parsed.resumes) ? parsed.resumes : [] };
  } catch {
    return { resumes: [] };
  }
}

function writeStore(store: ResumeStore): ResumeStore {
  atomicWriteWithBackup(storePath(), `${JSON.stringify(store, null, 2)}\n`);
  return store;
}

function extensionFor(filename: string): "pdf" | "docx" | null {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".pdf") return "pdf";
  if (ext === ".docx") return "docx";
  return null;
}

function sanitizeBase(filename: string): string {
  return path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_").slice(0, 80) || "resume";
}

function containedFilePath(storageRef: string): string | null {
  const base = path.resolve(filesDir());
  const target = path.resolve(careerOpsRoot(), storageRef);
  const relative = path.relative(base, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return target;
}

function validateUpload(input: ResumeUploadInput): { ok: true; ext: "pdf" | "docx"; safeName: string } | { ok: false; status: number; error: string } {
  const ext = extensionFor(input.originalFilename);
  if (!ext) return { ok: false, status: 400, error: "resume must be PDF or DOCX" };
  if (input.contentType !== ALLOWED[ext]) return { ok: false, status: 400, error: "resume content type is not allowed" };
  if (input.bytes.length > MAX_RESUME_BYTES) return { ok: false, status: 413, error: "resume is too large" };
  if (input.bytes.length === 0) return { ok: false, status: 400, error: "resume file is empty" };
  if (/\.(exe|sh|bat|cmd|js|mjs|ts|tsx|php|py|rb|pl|jar|app)$/i.test(input.originalFilename)) {
    return { ok: false, status: 400, error: "resume file type is not allowed" };
  }
  return { ok: true, ext, safeName: sanitizeBase(input.originalFilename) };
}

export function readResumeLibrary(userId?: string, profileScope?: string, includeArchived = false): ResumeLibraryItem[] {
  return readStore().resumes.filter((resume) => {
    if (!includeArchived && resume.isArchived) return false;
    if (userId && resume.userId !== userId) return false;
    if (profileScope && resume.profileScope !== profileScope) return false;
    return true;
  });
}

export function uploadResume(input: ResumeUploadInput): { ok: true; resume: ResumeLibraryItem } | { ok: false; status: number; error: string } {
  const validation = validateUpload(input);
  if (!validation.ok) return validation;
  const store = readStore();
  const now = nowIso();
  const id = `res_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const storageRel = `${FILES_REL}/${id}-v1.${validation.ext}`;
  const target = containedFilePath(storageRel);
  if (!target) return { ok: false, status: 400, error: "invalid resume storage path" };
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, input.bytes);
  const hasDefault = store.resumes.some((resume) => resume.userId === input.userId && resume.profileScope === input.profileScope && resume.isDefault && !resume.isArchived);
  const resume: ResumeLibraryItem = {
    id,
    userId: input.userId,
    profileScope: input.profileScope,
    label: input.name?.trim() || path.basename(validation.safeName, path.extname(validation.safeName)),
    name: input.name?.trim() || path.basename(validation.safeName, path.extname(validation.safeName)),
    category: input.category || "Applied AI",
    version: 1,
    originalFilename: validation.safeName,
    path: storageRel,
    storageRef: storageRel,
    format: validation.ext,
    status: "ready",
    isDefault: !hasDefault,
    isArchived: false,
    recommendedFor: [input.category || "Applied AI"],
    notes: input.notes,
    createdAt: now,
    updatedAt: now,
  };
  store.resumes.push(resume);
  writeStore(store);
  return { ok: true, resume };
}

export function updateResumeMetadata(
  id: string,
  context: { userId: string; profileScope: string },
  patch: Partial<Pick<ResumeLibraryItem, "name" | "label" | "category" | "notes" | "isDefault" | "isArchived">>,
): ResumeLibraryItem | null {
  const store = readStore();
  const resume = store.resumes.find((item) => item.id === id && item.userId === context.userId && item.profileScope === context.profileScope);
  if (!resume) return null;
  if (patch.name !== undefined) {
    resume.name = String(patch.name).trim();
    resume.label = resume.name;
  }
  if (patch.label !== undefined) resume.label = String(patch.label).trim();
  if (patch.category !== undefined) {
    resume.category = String(patch.category).trim() || "Applied AI";
    resume.recommendedFor = [resume.category];
  }
  if (patch.notes !== undefined) resume.notes = String(patch.notes);
  if (patch.isArchived !== undefined) resume.isArchived = Boolean(patch.isArchived);
  if (patch.isDefault) {
    for (const item of store.resumes) {
      if (item.userId === context.userId && item.profileScope === context.profileScope) item.isDefault = false;
    }
    resume.isDefault = true;
    resume.isArchived = false;
  } else if (patch.isDefault === false) {
    resume.isDefault = false;
  }
  resume.updatedAt = nowIso();
  writeStore(store);
  return resume;
}

export function replaceResumeVersion(
  id: string,
  input: ResumeUploadInput,
): { ok: true; resume: ResumeLibraryItem } | { ok: false; status: number; error: string } {
  const validation = validateUpload(input);
  if (!validation.ok) return validation;
  const store = readStore();
  const resume = store.resumes.find((item) => item.id === id && item.userId === input.userId && item.profileScope === input.profileScope);
  if (!resume) return { ok: false, status: 404, error: "resume not found" };
  const nextVersion = (resume.version ?? 1) + 1;
  const storageRel = `${FILES_REL}/${resume.id}-v${nextVersion}.${validation.ext}`;
  const target = containedFilePath(storageRel);
  if (!target) return { ok: false, status: 400, error: "invalid resume storage path" };
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, input.bytes);
  resume.version = nextVersion;
  resume.originalFilename = validation.safeName;
  resume.path = storageRel;
  resume.storageRef = storageRel;
  resume.format = validation.ext;
  resume.status = "ready";
  resume.updatedAt = nowIso();
  writeStore(store);
  return { ok: true, resume };
}

export function resumeFilePath(resume: ResumeLibraryItem): string | null {
  if (!resume.storageRef) return null;
  return containedFilePath(resume.storageRef);
}

export function assertResumeUploadForTest(input: ResumeUploadInput) {
  return validateUpload(input);
}
