import type { ApplyField } from "@/lib/apply/extract";
import { readCompanyAnswerPacks, readReusableAnswers } from "../answer-library";
import { readProfileRecord, type ProfileRecord } from "../profile-store";
import type { ApplicationPackage, CompanyAnswerPackEntry, QuestionClassification, ReusableApplicationAnswer } from "../types";
import type { ExecutionBlocker, FieldMapping } from "./types";

const SENSITIVE = /\b(salary|compensation|sponsor|visa|relocat|disability|veteran|gender|race|ethnicity|criminal|felony|clearance|conflict|outside business|legal|authorization)\b/i;

function normalized(value: string | undefined): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function verifiedString(profile: ProfileRecord, section: keyof ProfileRecord, key: string): string | undefined {
  const value = profile[section];
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const field = (value as Record<string, { value?: unknown; verificationState?: string }>)[key];
  if (!field || field.verificationState !== "verified") return undefined;
  if (Array.isArray(field.value)) return field.value.filter((item) => typeof item === "string" && item.trim()).join(", ") || undefined;
  if (typeof field.value === "boolean") return field.value ? "Yes" : "No";
  return typeof field.value === "string" && field.value.trim() ? field.value.trim() : undefined;
}

function namePart(name: string | undefined, part: "first" | "last"): string | undefined {
  const pieces = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!pieces.length) return undefined;
  return part === "first" ? pieces[0] : pieces.slice(1).join(" ") || pieces[0];
}

function profileValue(pkg: ApplicationPackage, field: ApplyField): string | undefined {
  const profile = readProfileRecord(pkg.userId, pkg.profileScope);
  const label = normalized(`${field.label} ${field.nativeName ?? ""} ${field.nativeId ?? ""}`);
  const fullName = verifiedString(profile, "personal", "name");
  if (/\b(first name|given name)\b/.test(label)) return namePart(fullName, "first");
  if (/\b(last name|family name|surname)\b/.test(label)) return namePart(fullName, "last");
  if (/\b(full name|name)\b/.test(label)) return fullName;
  if (/\bemail|e mail\b/.test(label)) return verifiedString(profile, "personal", "email");
  if (/\bphone|mobile|telephone\b/.test(label)) return verifiedString(profile, "personal", "phone");
  if (/\blinkedin\b/.test(label)) return verifiedString(profile, "personal", "linkedin");
  if (/\bgithub\b/.test(label)) return verifiedString(profile, "personal", "github");
  if (/\bportfolio|website|url\b/.test(label)) return verifiedString(profile, "personal", "portfolioUrls");
  if (/\blocation|city|state|address\b/.test(label)) return verifiedString(profile, "personal", "location");
  return undefined;
}

function matchingQuestion(pkg: ApplicationPackage, field: ApplyField) {
  const label = normalized(field.label);
  return pkg.questions.find((question) => {
    const q = normalized(question.label);
    return q && (label.includes(q.slice(0, 50)) || q.includes(label.slice(0, 50)));
  });
}

function matchAnswerLabel(label: string, answer: Pick<ReusableApplicationAnswer, "title" | "label" | "answerType">): boolean {
  const candidates = [answer.title, answer.label, answer.answerType].map(normalized).filter(Boolean);
  return candidates.some((candidate) => label.includes(candidate) || candidate.includes(label));
}

function matchingReusableAnswer(pkg: ApplicationPackage, field: ApplyField): ReusableApplicationAnswer | undefined {
  const label = normalized(field.label);
  if (!label) return undefined;
  return readReusableAnswers(pkg.userId, pkg.profileScope).find((answer) => {
    if (answer.isArchived || !answer.content && !answer.value) return false;
    return matchAnswerLabel(label, answer);
  });
}

function matchingCompanyAnswer(pkg: ApplicationPackage, field: ApplyField): CompanyAnswerPackEntry | undefined {
  const label = normalized(field.label);
  if (!label) return undefined;
  const company = normalized(pkg.company);
  return readCompanyAnswerPacks(pkg.userId, pkg.profileScope)
    .filter((pack) => !pack.isArchived && [pack.company, ...pack.aliases].map(normalized).includes(company))
    .flatMap((pack) => pack.entries.filter((entry) => !entry.isArchived))
    .find((entry) => matchAnswerLabel(label, { title: entry.title, label: entry.title, answerType: entry.answerType }));
}

export function classifyField(field: ApplyField, pkg: ApplicationPackage): QuestionClassification {
  const label = `${field.label} ${field.nativeName ?? ""} ${field.nativeId ?? ""}`;
  if (field.type === "file" && /resume|résumé|\bcv\b/i.test(label)) return "SAFE_AUTOFILL";
  if (SENSITIVE.test(label)) return "USER_REQUIRED";
  const question = matchingQuestion(pkg, field);
  if (question) return question.classification;
  const companyAnswer = matchingCompanyAnswer(pkg, field);
  if (companyAnswer) return companyAnswer.classification;
  const reusableAnswer = matchingReusableAnswer(pkg, field);
  if (reusableAnswer) return reusableAnswer.classification ?? "REVIEW_REQUIRED";
  if (/\b(first name|last name|full name|email|phone|linkedin|github|portfolio|website|location)\b/i.test(label)) return "SAFE_AUTOFILL";
  if (field.required) return "USER_REQUIRED";
  return "REVIEW_REQUIRED";
}

export function mapPackageFields(fields: ApplyField[], pkg: ApplicationPackage): FieldMapping[] {
  return fields.map((field) => {
    const classification = classifyField(field, pkg);
    const question = matchingQuestion(pkg, field);
    const companyAnswer = matchingCompanyAnswer(pkg, field);
    const reusableAnswer = matchingReusableAnswer(pkg, field);
    const profile = profileValue(pkg, field);
    const value = question?.value ?? question?.draft ?? companyAnswer?.content ?? reusableAnswer?.content ?? reusableAnswer?.value ?? profile;
    const blocker: ExecutionBlocker | undefined =
      classification === "USER_REQUIRED" && field.required
        ? { code: "USER_REQUIRED_FIELD", message: `Required field needs David: ${field.label || field.id}`, action: "Answer this field in the application review or live ATS form.", fieldId: field.id }
        : field.required && !value && field.type !== "file"
          ? { code: "UNKNOWN_REQUIRED_FIELD", message: `Unknown required field: ${field.label || field.id}`, action: "Review the ATS field and provide an approved answer.", fieldId: field.id }
          : undefined;
    return {
      field,
      classification,
      value,
      source: question ? "package_question" : companyAnswer ? "company_pack" : reusableAnswer ? "answer_library" : profile ? "profile" : field.type === "file" ? "resume" : "unknown",
      status: blocker ? "blocked" : value || field.type === "file" ? "mapped" : "missing",
      blocker,
    };
  });
}

export function dryRunReport(ats: ApplicationPackage["atsType"], mappings: FieldMapping[], resume: "READY" | "MISSING" | "VERSION_MISMATCH", blockers: ExecutionBlocker[]) {
  return {
    ats,
    fieldsFound: mappings.length,
    safeAutofill: mappings.filter((item) => item.classification === "SAFE_AUTOFILL").map((item) => item.field.label || item.field.id),
    reviewRequired: mappings.filter((item) => item.classification === "REVIEW_REQUIRED").map((item) => item.field.label || item.field.id),
    userRequired: mappings.filter((item) => item.classification === "USER_REQUIRED").map((item) => item.field.label || item.field.id),
    unknownRequired: blockers.filter((item) => item.code === "UNKNOWN_REQUIRED_FIELD").map((item) => item.fieldId ?? item.message),
    resume,
    validation: blockers.length ? "BLOCKED" as const : "READY" as const,
    readyForLiveSubmission: blockers.length === 0 && resume === "READY",
    blockers,
  };
}
