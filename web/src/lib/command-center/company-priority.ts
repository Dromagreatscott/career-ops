import type { CompanyPriority } from "./types";

const DEFAULT_DREAM_COMPANIES: CompanyPriority[] = [
  { company: "OpenAI", aliases: ["openai"], tier: 1, override_enabled: true, scoring_mode: "company_first" },
  { company: "Anthropic", aliases: ["anthropic"], tier: 1, override_enabled: true, scoring_mode: "company_first" },
  { company: "ElevenLabs", aliases: ["elevenlabs", "eleven labs"], tier: 1, override_enabled: true, scoring_mode: "company_first" },
  { company: "Google / Google DeepMind", aliases: ["google", "google deepmind", "deepmind"], tier: 1, override_enabled: true, scoring_mode: "company_first" },
  { company: "xAI", aliases: ["xai", "x.ai"], tier: 1, override_enabled: true, scoring_mode: "company_first" },
];

export const DEFAULT_COMPANY_PRIORITY: CompanyPriority = {
  company: "",
  aliases: [],
  tier: null,
  override_enabled: false,
  scoring_mode: "role_first",
};

export function normalizeCompanyKey(value: string | undefined | null): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function priorityFromRaw(raw: unknown): CompanyPriority | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const company = String(obj.company ?? obj.name ?? "").trim();
  if (!company) return null;
  const rawTier = Number(obj.tier);
  const tier = rawTier === 1 || rawTier === 2 || rawTier === 3 ? rawTier : null;
  const overrideEnabled = typeof obj.override_enabled === "boolean" ? obj.override_enabled : tier === 1;
  return {
    company,
    aliases: asList(obj.aliases).map(String).map((s) => s.trim()).filter(Boolean),
    tier,
    override_enabled: overrideEnabled,
    scoring_mode: overrideEnabled && tier === 1 ? "company_first" : "role_first",
  };
}

export function companyPrioritiesFromProfile(profile: Record<string, unknown> | null): CompanyPriority[] {
  const configured =
    asList((profile?.company_priority as Record<string, unknown> | undefined)?.companies)
      .map(priorityFromRaw)
      .filter((item): item is CompanyPriority => !!item);

  const byKey = new Map<string, CompanyPriority>();
  for (const priority of [...DEFAULT_DREAM_COMPANIES, ...configured]) {
    byKey.set(normalizeCompanyKey(priority.company), priority);
    for (const alias of priority.aliases) byKey.set(normalizeCompanyKey(alias), priority);
  }

  return [...new Set(byKey.values())];
}

export function companyPriorityFor(company: string, priorities: CompanyPriority[]): CompanyPriority {
  const key = normalizeCompanyKey(company);
  if (!key) return { ...DEFAULT_COMPANY_PRIORITY, company };
  for (const priority of priorities) {
    const keys = [priority.company, ...priority.aliases].map(normalizeCompanyKey);
    if (keys.some((candidate) => candidate && (candidate === key || key.includes(candidate) || candidate.includes(key)))) {
      return priority;
    }
  }
  return { ...DEFAULT_COMPANY_PRIORITY, company };
}
