import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: {
    "@": path.resolve("src"),
  },
});
const packages = jiti("./src/lib/command-center/application-packages.ts");
const urls = jiti("./src/lib/security/url.ts");
const statusRoute = jiti("./src/app/api/status/route.ts");

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-hardening-"));
  fs.mkdirSync(path.join(root, "data", "application-packages"), { recursive: true });
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  return root;
}

function useRoot() {
  const root = tempRoot();
  process.env.CAREER_OPS_ROOT = root;
  return root;
}

function profile() {
  const resumePath = "data/David_Scott_AI_Resume_2026_v4_4_MASTER_ATS.pdf";
  return {
    contact: {},
    employmentHistory: [],
    education: [],
    portfolio: [],
    preferredRoles: [],
    standardAnswers: { work_authorization: "Yes", onsite_availability: "Remote" },
    reusableAnswers: [],
    verification: [],
    resumeVariants: [],
    resumeLibrary: [
      {
        id: "resume-master-ats",
        label: "David Scott Applied AI Resume",
        path: resumePath,
        format: "pdf",
        status: fs.existsSync(path.join(process.env.CAREER_OPS_ROOT ?? "", resumePath)) ? "ready" : "missing",
        isDefault: true,
        recommendedFor: ["Applied AI", "AI architecture"],
      },
    ],
    dreamCompanies: [],
    excludedRoleTypes: [],
  };
}

function job(overrides = {}) {
  return {
    id: "job-1",
    company: "Acme",
    title: "AI Architect",
    source: "Hawkeye",
    applicationPlatform: "Employer",
    sourceUrl: "https://example.com/jobs/1",
    canonicalApplyUrl: "https://example.com/jobs/1/apply",
    canonicalApplyStatus: "resolved",
    fitScore: 4.2,
    fitSummary: "Strong fit.",
    companyPriority: { company: "Acme", aliases: [], tier: null, override_enabled: false, scoring_mode: "role_first" },
    dreamCompany: false,
    stage: "Qualified",
    ...overrides,
  };
}

function writePackage(pkg) {
  return packages.writeApplicationPackage(pkg);
}

test("valid package ID is accepted", () => {
  const result = packages.validatePackageId("pkg_0123456789abcdef");
  assert.equal(result.ok, true);
});

test("../ traversal package ID is rejected", () => {
  const result = packages.validatePackageId("../pkg_0123456789abcdef");
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
});

test("encoded traversal package ID is rejected", () => {
  const result = packages.validatePackageId("%2e%2e%2fpkg_0123456789abcdef");
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
});

test("malformed package is quarantined and not returned", () => {
  const root = useRoot();
  const file = path.join(root, "data", "application-packages", "pkg_0123456789abcdef.json");
  fs.writeFileSync(file, "{\"id\":", "utf8");
  assert.deepEqual(packages.readApplicationPackages(), []);
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.existsSync(path.join(root, "data", "application-packages", "package-audit.jsonl")), true);
});

test("tampered package hash is rejected", () => {
  useRoot();
  const pkg = writePackage(packages.buildApplicationPackage(job(), profile()));
  const file = path.join(process.env.CAREER_OPS_ROOT, "data", "application-packages", `${pkg.id}.json`);
  const tampered = JSON.parse(fs.readFileSync(file, "utf8"));
  tampered.company = "Evil Corp";
  fs.writeFileSync(file, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");
  const result = packages.readApplicationPackage(pkg.id);
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
});

test("stale approval hash is rejected", () => {
  useRoot();
  const pkg = writePackage(packages.buildApplicationPackage(job(), profile()));
  const result = packages.decideApplicationPackage(pkg.id, "0".repeat(64), pkg.version, "approved");
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
});

test("duplicate decision replay is rejected", () => {
  useRoot();
  const pkg = writePackage(packages.buildApplicationPackage(job(), profile()));
  const first = packages.decideApplicationPackage(pkg.id, pkg.packageHash, pkg.version, "approved");
  assert.equal(first.ok, true);
  const replay = packages.decideApplicationPackage(pkg.id, pkg.packageHash, pkg.version, "approved");
  assert.equal(replay.ok, false);
  assert.equal(replay.status, 409);
});

test("invalid package status transition is rejected", () => {
  useRoot();
  const pkg = writePackage(packages.buildApplicationPackage(job(), profile(), { status: "PREPARING" }));
  const result = packages.decideApplicationPackage(pkg.id, pkg.packageHash, pkg.version, "approved");
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
});

test("valid approval succeeds", () => {
  useRoot();
  const pkg = writePackage(packages.buildApplicationPackage(job(), profile()));
  const result = packages.decideApplicationPackage(pkg.id, pkg.packageHash, pkg.version, "approved");
  assert.equal(result.ok, true);
  assert.equal(result.package.status, "APPROVED");
  assert.equal(result.package.approval.packageHash, pkg.packageHash);
});

test("application package records recommended resume metadata", () => {
  const root = useRoot();
  fs.writeFileSync(path.join(root, "data", "David_Scott_AI_Resume_2026_v4_4_MASTER_ATS.pdf"), "pdf", "utf8");
  const pkg = packages.buildApplicationPackage(job(), profile());
  assert.equal(pkg.selectedResume.id, "resume-master-ats");
  assert.equal(pkg.selectedResume.status, "ready");
  assert.equal(pkg.selectedResume.selection, "recommended");
  assert.match(pkg.selectedResume.recommendationReason, /Recommended/);
});

test("resume override changes package hash and increments version", () => {
  const root = useRoot();
  fs.writeFileSync(path.join(root, "data", "David_Scott_AI_Resume_2026_v4_4_MASTER_ATS.pdf"), "pdf", "utf8");
  fs.writeFileSync(path.join(root, "data", "leadership_resume.pdf"), "pdf", "utf8");
  const profileData = profile();
  profileData.resumeLibrary.push({
    id: "resume-leadership",
    label: "Leadership Resume",
    path: "data/leadership_resume.pdf",
    format: "pdf",
    status: "ready",
    isDefault: false,
    recommendedFor: ["Director", "Head of AI"],
  });
  const first = packages.prepareApplicationPackage(job(), profileData);
  const result = packages.overrideApplicationPackageResume(first.id, first.packageHash, first.version, "resume-leadership", profileData, job());
  assert.equal(result.ok, true);
  assert.equal(result.package.selectedResume.id, "resume-leadership");
  assert.equal(result.package.selectedResume.selection, "override");
  assert.equal(result.package.version, first.version + 1);
  assert.notEqual(result.package.packageHash, first.packageHash);
});

test("package mutation invalidates approval and increments version", () => {
  useRoot();
  const first = packages.prepareApplicationPackage(job(), profile());
  const approved = packages.decideApplicationPackage(first.id, first.packageHash, first.version, "approved");
  assert.equal(approved.ok, true);
  const mutated = packages.prepareApplicationPackage(job({ title: "Principal AI Architect" }), profile());
  assert.equal(mutated.status, "READY_FOR_REVIEW");
  assert.equal(mutated.approval, undefined);
  assert.equal(mutated.version, first.version + 1);
  assert.notEqual(mutated.packageHash, first.packageHash);
});

test("javascript URL is rejected", () => {
  assert.equal(urls.validateExternalUrl("javascript:alert(1)").ok, false);
});

test("data URL is rejected", () => {
  assert.equal(urls.validateExternalUrl("data:text/plain,hello").ok, false);
});

test("https URL is accepted and normalized", () => {
  const result = urls.validateExternalUrl("https://EXAMPLE.com/jobs/1");
  assert.equal(result.ok, true);
  assert.equal(result.url, "https://example.com/jobs/1");
});

test("unsupported but valid ATS URL is handled honestly", () => {
  useRoot();
  const pkg = packages.buildApplicationPackage(job({ canonicalApplyUrl: "https://jobs.example.org/postings/123" }), profile());
  assert.equal(pkg.atsType, "unknown");
  assert.equal(pkg.canonicalApplyUrl, "https://jobs.example.org/postings/123");
});

test("anonymous status updates are denied without echoing raw internal-looking values", async () => {
  useRoot();
  const secret = "/root/very-sensitive/path";
  const req = new Request("http://localhost/api/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ n: "1", status: secret }),
  });
  const res = await statusRoute.POST(req);
  const body = await res.json();
  assert.equal(res.status, 401);
  assert.equal(String(body.error).includes(secret), false);
});
