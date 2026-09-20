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

const adapters = jiti("./src/lib/command-center/ats-executor/adapters.ts");
const fieldMapping = jiti("./src/lib/command-center/ats-executor/field-mapping.ts");
const sessions = jiti("./src/lib/command-center/application-sessions.ts");
const urls = jiti("./src/lib/command-center/executor-url.ts");
const ashby = jiti("./src/lib/command-center/ats-executor/ashby.ts");
const workday = jiti("./src/lib/command-center/ats-executor/workday.ts");
const generic = jiti("./src/lib/command-center/ats-executor/generic.ts");
const statusRoute = jiti("./src/app/api/status/route.ts");

function useRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-phase3-"));
  fs.mkdirSync(path.join(root, "data", "web"), { recursive: true });
  fs.mkdirSync(path.join(root, "data", "application-packages"), { recursive: true });
  process.env.CAREER_OPS_ROOT = root;
  return root;
}

function basePackage(overrides = {}) {
  return {
    id: "pkg_0123456789abcdef",
    userId: "u1",
    profileScope: "scope1",
    version: 1,
    packageHash: "hash-1",
    company: "Acme",
    roleTitle: "AI Architect",
    atsType: "greenhouse",
    canonicalJobUrl: "https://example.com/job",
    canonicalApplyUrl: "https://boards.greenhouse.io/acme/jobs/123",
    status: "APPROVED",
    approval: {
      status: "approved",
      packageHash: "hash-1",
    },
    questions: [],
    ...overrides,
  };
}

test("Greenhouse ATS is detected", () => {
  const type = adapters.detectExecutionAts(
    new URL("https://boards.greenhouse.io/acme/jobs/123")
  );
  assert.equal(type, "greenhouse");
});

test("Lever ATS is detected", () => {
  const type = adapters.detectExecutionAts(
    new URL("https://jobs.lever.co/acme/abc123")
  );
  assert.equal(type, "lever");
});

test("unsupported ATS returns unknown", () => {
  const type = adapters.detectExecutionAts(
    new URL("https://careers.example.com/jobs/123")
  );
  assert.equal(type, "unknown");
});

test("javascript URL is rejected", () => {
  const result = urls.validateExecutionUrlSyncForTest("javascript:alert(1)");
  assert.equal(result.ok, false);
  assert.equal(result.code, "bad_url");
});

test("localhost URL is rejected", () => {
  const result = urls.validateExecutionUrlSyncForTest("http://localhost:3000/apply");
  assert.equal(result.ok, false);
  assert.equal(result.code, "private_host");
});

test("loopback IP is rejected", () => {
  const result = urls.validateExecutionUrlSyncForTest("http://127.0.0.1/apply");
  assert.equal(result.ok, false);
  assert.equal(result.code, "private_host");
});

test("RFC1918 private IP is rejected", () => {
  const result = urls.validateExecutionUrlSyncForTest("http://192.168.1.10/apply");
  assert.equal(result.ok, false);
  assert.equal(result.code, "private_host");
});

test("public HTTPS URL is accepted", () => {
  const result = urls.validateExecutionUrlSyncForTest(
    "https://boards.greenhouse.io/acme/jobs/123"
  );
  assert.equal(result.ok, true);
});

test("resume file field is SAFE_AUTOFILL", () => {
  useRoot();

  const field = {
    id: "resume",
    label: "Resume",
    type: "file",
    required: true,
  };

  assert.equal(
    fieldMapping.classifyField(field, basePackage()),
    "SAFE_AUTOFILL"
  );
});

test("sensitive compensation field is USER_REQUIRED", () => {
  useRoot();

  const field = {
    id: "salary",
    label: "Desired salary",
    type: "text",
    required: true,
  };

  assert.equal(
    fieldMapping.classifyField(field, basePackage()),
    "USER_REQUIRED"
  );
});

test("sponsorship field is USER_REQUIRED", () => {
  useRoot();

  const field = {
    id: "sponsorship",
    label: "Will you require visa sponsorship?",
    type: "text",
    required: true,
  };

  assert.equal(
    fieldMapping.classifyField(field, basePackage()),
    "USER_REQUIRED"
  );
});

test("basic contact field is SAFE_AUTOFILL", () => {
  useRoot();

  const field = {
    id: "email",
    label: "Email",
    type: "text",
    required: true,
  };

  assert.equal(
    fieldMapping.classifyField(field, basePackage()),
    "SAFE_AUTOFILL"
  );
});

test("optional unknown narrative field is REVIEW_REQUIRED", () => {
  useRoot();

  const field = {
    id: "motivation",
    label: "Tell us why you want this role",
    type: "textarea",
    required: false,
  };

  assert.equal(
    fieldMapping.classifyField(field, basePackage()),
    "REVIEW_REQUIRED"
  );
});

test("required USER_REQUIRED field creates blocker", () => {
  useRoot();

  const mappings = fieldMapping.mapPackageFields(
    [
      {
        id: "salary",
        label: "Desired compensation",
        type: "text",
        required: true,
      },
    ],
    basePackage()
  );

  assert.equal(mappings.length, 1);
  assert.equal(mappings[0].classification, "USER_REQUIRED");
  assert.equal(mappings[0].status, "blocked");
  assert.equal(mappings[0].blocker.code, "USER_REQUIRED_FIELD");
});

test("application session IDs validate", () => {
  const good = sessions.validateSessionId("exec_0123456789abcdef");
  const bad = sessions.validateSessionId("../exec_0123456789abcdef");

  assert.equal(good.ok, true);
  assert.equal(bad.ok, false);
});

test("dry-run application session can be created", () => {
  useRoot();

  const result = sessions.createApplicationSession({
    userId: "u1",
    profileScope: "scope1",
    applicationPackageId: "pkg_0123456789abcdef",
    applicationPackageVersion: 1,
    applicationPackageHash: "hash-1",
    atsType: "greenhouse",
    applicationUrl: "https://boards.greenhouse.io/acme/jobs/123",
    canonicalUrl: "https://boards.greenhouse.io/acme/jobs/123",
    mode: "DRY_RUN",
  });

  assert.equal(result.ok, true);
  assert.equal(result.session.mode, "DRY_RUN");
  assert.equal(result.session.status, "SUBMITTING");
});

test("duplicate active LIVE execution is rejected", () => {
  useRoot();

  const input = {
    userId: "u1",
    profileScope: "scope1",
    applicationPackageId: "pkg_0123456789abcdef",
    applicationPackageVersion: 1,
    applicationPackageHash: "hash-1",
    atsType: "greenhouse",
    applicationUrl: "https://boards.greenhouse.io/acme/jobs/123",
    canonicalUrl: "https://boards.greenhouse.io/acme/jobs/123",
    mode: "LIVE",
  };

  const first = sessions.createApplicationSession(input);
  assert.equal(first.ok, true);

  const second = sessions.createApplicationSession(input);
  assert.equal(second.ok, false);
  assert.equal(second.code, "DUPLICATE_SUBMISSION");
});

test("intervention session requires explicit resume", () => {
  useRoot();

  const created = sessions.createApplicationSession({
    userId: "u1",
    profileScope: "scope1",
    applicationPackageId: "pkg_0123456789abcdef",
    applicationPackageVersion: 1,
    applicationPackageHash: "hash-1",
    atsType: "greenhouse",
    applicationUrl: "https://boards.greenhouse.io/acme/jobs/123",
    canonicalUrl: "https://boards.greenhouse.io/acme/jobs/123",
    mode: "LIVE",
  });

  assert.equal(created.ok, true);

  const blocked = sessions.markIntervention(
    created.session.id,
    "CAPTCHA_REQUIRED",
    "CAPTCHA detected",
    "Complete the CAPTCHA manually."
  );

  assert.equal(blocked.status, "USER_INTERVENTION_REQUIRED");
  assert.equal(blocked.requiresUserAction, true);

  const resumed = sessions.resumeApplicationSession(created.session.id);
  assert.equal(resumed.ok, true);
  assert.equal(resumed.session.status, "SUBMITTING");
  assert.equal(resumed.session.requiresUserAction, false);
});

test("dry run report reflects blockers and readiness", () => {
  const report = fieldMapping.dryRunReport(
    "greenhouse",
    [],
    "READY",
    [
      {
        code: "UNKNOWN_REQUIRED_FIELD",
        message: "Unknown required field",
        action: "Review it",
        fieldId: "q1",
      },
    ]
  );

  assert.equal(report.validation, "BLOCKED");
  assert.equal(report.readyForLiveSubmission, false);
  assert.deepEqual(report.unknownRequired, ["q1"]);
});

// ---------------------------------------------------------------------------
// Phase 3 — Ashby / Workday / Generic fallback foundation
// ---------------------------------------------------------------------------

/** Seed a temp root with a package selectable resume file so uploadResume/validate
 *  can reach a READY state (no library entry needed — path fallback is used). */
function readyResumePackage(root, overrides = {}) {
  fs.writeFileSync(path.join(root, "data", "dummy-resume.pdf"), "%PDF-1.4 test");
  return basePackage({
    selectedResume: { id: "res_master", label: "Master", status: "ready", version: 1, path: "data/dummy-resume.pdf" },
    ...overrides,
  });
}

/** Minimal ExecutionContext for adapter method calls in unit tests. */
function ctxFor(pkg, over = {}) {
  return {
    session: { canonicalUrl: pkg.canonicalApplyUrl, atsType: pkg.atsType },
    pkg,
    mode: "DRY_RUN",
    dryRunFill: false,
    ...over,
  };
}

/** Build an InspectedApplication-shaped fixture. */
function inspectedForm(over = {}) {
  return { title: "", url: "https://acme.wd5.myworkdayjobs.com/careers/job/123", fields: [], issues: [], ...over };
}

test("Ashby ATS is detected", () => {
  assert.equal(adapters.detectExecutionAts(new URL("https://jobs.ashbyhq.com/acme/8f1c2b3a-uuid")), "ashby");
  assert.equal(adapters.detectExecutionAts(new URL("https://acme.ashbyhq.com/careers/roles/123")), "ashby");
});

test("Workday ATS is detected", () => {
  assert.equal(adapters.detectExecutionAts(new URL("https://acme.wd5.myworkdayjobs.com/careers/job/Remote/AI-Architect_R123")), "workday");
  assert.equal(adapters.detectExecutionAts(new URL("https://acme.wd1.myworkdayjobs.com/External/job/123")), "workday");
});

test("generic fallback adapter is selected for unknown ATS", () => {
  const url = new URL("https://careers.example.com/apply/123");
  const adapter = adapters.adapterForUrl(url);
  assert.notEqual(adapter, null);
  assert.equal(adapter.type, "unknown");
  assert.equal(adapter.isGenericFallback, true);
  // Detection still reports unknown for these pages.
  assert.equal(adapters.detectExecutionAts(url), "unknown");
  // First-class adapters still win over the generic fallback.
  assert.equal(adapters.adapterForUrl(new URL("https://boards.greenhouse.io/acme/jobs/123")).type, "greenhouse");
});

test("Ashby fixture fields map by classification", async () => {
  useRoot();
  const pkg = basePackage({ atsType: "ashby" });
  const inspected = inspectedForm({
    url: "https://jobs.ashbyhq.com/acme/uuid",
    fields: [
      { id: "resume", label: "Resume", type: "file", required: true },
      { id: "email", label: "Email", type: "email", required: true },
      { id: "why", label: "Why do you want to work at Acme?", type: "textarea", required: false },
      { id: "salary", label: "Desired salary", type: "text", required: true },
    ],
  });
  const mappings = await new ashby.AshbyAdapter().mapFields(ctxFor(pkg), inspected);
  const byId = Object.fromEntries(mappings.map((m) => [m.field.id, m]));
  assert.equal(byId.resume.classification, "SAFE_AUTOFILL");
  assert.equal(byId.email.classification, "SAFE_AUTOFILL");
  assert.equal(byId.why.classification, "REVIEW_REQUIRED");
  assert.equal(byId.salary.classification, "USER_REQUIRED");
  assert.equal(byId.salary.status, "blocked");
});

test("Workday fixture fields map by classification", async () => {
  useRoot();
  const pkg = basePackage({ atsType: "workday" });
  const inspected = inspectedForm({
    fields: [
      { id: "firstName", label: "First Name", type: "text", required: true },
      { id: "resume", label: "Resume/CV", type: "file", required: true },
      { id: "sponsor", label: "Will you now or in the future require sponsorship?", type: "select", required: true, options: ["Yes", "No"] },
    ],
  });
  const mappings = await new workday.WorkdayAdapter().mapFields(ctxFor(pkg), inspected);
  const byId = Object.fromEntries(mappings.map((m) => [m.field.id, m]));
  assert.equal(byId.firstName.classification, "SAFE_AUTOFILL");
  assert.equal(byId.resume.classification, "SAFE_AUTOFILL");
  assert.equal(byId.sponsor.classification, "USER_REQUIRED");
});

test("Workday login gate → LOGIN_REQUIRED", () => {
  const blocker = workday.classifyWorkdayIntervention(
    inspectedForm({ title: "Sign In", url: "https://acme.wd5.myworkdayjobs.com/login", issues: [{ code: "login-wall", message: "Sign in to your existing candidate account to continue", level: "block" }] })
  );
  assert.equal(blocker.code, "LOGIN_REQUIRED");
  assert.equal(sessions.accountStateForBlocker(blocker.code), "ACCOUNT_EXISTS_LOGIN_REQUIRED");
});

test("Workday account-creation gate → ACCOUNT_CREATION_REQUIRED", () => {
  const blocker = workday.classifyWorkdayIntervention(
    inspectedForm({ title: "Create Account", issues: [{ code: "login-wall", message: "Create a candidate account to start your application", level: "block" }] })
  );
  assert.equal(blocker.code, "ACCOUNT_CREATION_REQUIRED");
  assert.equal(sessions.accountStateForBlocker(blocker.code), "ACCOUNT_CREATION_REQUIRED");
});

test("Workday account-creation gate → ACCOUNT_CREATION_REQUIRED without a clean heading", () => {
  // Regression: the only account signal is the message phrasing "create a
  // candidate account" (adjective between "a" and "account"), with no "Create
  // Account" title and a generic diagnose code of "login-wall". Must still
  // classify as account creation, not login.
  const blocker = workday.classifyWorkdayIntervention(
    inspectedForm({ title: "", issues: [{ code: "login-wall", message: "Create a candidate account to start your application", level: "block" }] })
  );
  assert.equal(blocker.code, "ACCOUNT_CREATION_REQUIRED");
  assert.equal(sessions.accountStateForBlocker(blocker.code), "ACCOUNT_CREATION_REQUIRED");
});

test("Workday email-verification gate → EMAIL_VERIFICATION_REQUIRED", () => {
  const blocker = workday.classifyWorkdayIntervention(
    inspectedForm({ title: "Verify your email", issues: [{ code: "no-form", message: "Check your inbox to verify your email address before continuing", level: "block" }] })
  );
  assert.equal(blocker.code, "EMAIL_VERIFICATION_REQUIRED");
  assert.equal(sessions.accountStateForBlocker(blocker.code), "EMAIL_VERIFICATION_REQUIRED");
});

test("Workday MFA gate → MFA_REQUIRED (even if fields rendered)", () => {
  const blocker = workday.classifyWorkdayIntervention(
    inspectedForm({
      title: "Two-step verification",
      fields: [{ id: "code", label: "Code", type: "text", required: true }],
      issues: [{ code: "no-form", message: "Enter the one-time passcode from your authenticator app", level: "block" }],
    })
  );
  assert.equal(blocker.code, "MFA_REQUIRED");
  assert.equal(sessions.accountStateForBlocker(blocker.code), "MFA_REQUIRED");
});

test("Workday CAPTCHA gate → CAPTCHA_REQUIRED (never bypassed)", () => {
  const blocker = workday.classifyWorkdayIntervention(
    inspectedForm({ issues: [{ code: "bot-challenge", message: "Verify you're human before continuing", level: "block" }] })
  );
  assert.equal(blocker.code, "CAPTCHA_REQUIRED");
  assert.equal(sessions.accountStateForBlocker(blocker.code), "CAPTCHA_REQUIRED");
});

test("Workday reachable form has no gate (APPLICATION_READY path)", () => {
  const blocker = workday.classifyWorkdayIntervention(
    inspectedForm({
      title: "Application",
      fields: [
        { id: "firstName", label: "First Name", type: "text", required: true },
        { id: "resume", label: "Resume", type: "file", required: true },
      ],
      issues: [],
    })
  );
  assert.equal(blocker, null);
});

test("account state mapping covers every intervention code", () => {
  assert.equal(sessions.accountStateForBlocker("LOGIN_REQUIRED"), "ACCOUNT_EXISTS_LOGIN_REQUIRED");
  assert.equal(sessions.accountStateForBlocker("ACCOUNT_CREATION_REQUIRED"), "ACCOUNT_CREATION_REQUIRED");
  assert.equal(sessions.accountStateForBlocker("EMAIL_VERIFICATION_REQUIRED"), "EMAIL_VERIFICATION_REQUIRED");
  assert.equal(sessions.accountStateForBlocker("MFA_REQUIRED"), "MFA_REQUIRED");
  assert.equal(sessions.accountStateForBlocker("CAPTCHA_REQUIRED"), "CAPTCHA_REQUIRED");
  assert.equal(sessions.accountStateForBlocker("UNKNOWN_REQUIRED_FIELD"), "USER_INTERVENTION_REQUIRED");
});

test("generic fallback flags an unsupported widget", async () => {
  const root = useRoot();
  const pkg = readyResumePackage(root, { atsType: "unknown" });
  const inspected = inspectedForm({
    url: "https://careers.example.com/apply",
    fields: [{ id: "team", label: "Preferred team", type: "select", required: false, combobox: true, options: [] }],
  });
  const blockers = await new generic.GenericAtsAdapter().validate(ctxFor(pkg), inspected);
  assert.ok(blockers.some((b) => b.code === "UNSUPPORTED_WIDGET"));
});

test("generic fallback flags an unknown required field", async () => {
  const root = useRoot();
  const pkg = readyResumePackage(root, { atsType: "unknown" });
  const inspected = inspectedForm({
    url: "https://careers.example.com/apply",
    fields: [{ id: "linkedin", label: "LinkedIn URL", type: "url", required: true }],
  });
  const blockers = await new generic.GenericAtsAdapter().validate(ctxFor(pkg), inspected);
  assert.ok(blockers.some((b) => b.code === "UNKNOWN_REQUIRED_FIELD"));
});

test("resume version mismatch returns RESUME_VERSION_MISMATCH", async () => {
  const root = useRoot();
  fs.mkdirSync(path.join(root, "data", "web", "resumes"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "data", "web", "resumes", "metadata.json"),
    JSON.stringify({ resumes: [{ id: "res_x", userId: "u1", profileScope: "scope1", label: "R", path: "", storageRef: "", format: "pdf", status: "ready", isDefault: true, recommendedFor: [], version: 2 }] })
  );
  const pkg = basePackage({ selectedResume: { id: "res_x", label: "R", status: "ready", version: 1 } });
  const blocker = await new ashby.AshbyAdapter().uploadResume(ctxFor(pkg));
  assert.equal(blocker.code, "RESUME_VERSION_MISMATCH");
});

test("explicit resume after Workday intervention restores execution", () => {
  useRoot();
  const created = sessions.createApplicationSession({
    userId: "u1",
    profileScope: "scope1",
    applicationPackageId: "pkg_0123456789abcdef",
    applicationPackageVersion: 1,
    applicationPackageHash: "hash-1",
    atsType: "workday",
    applicationUrl: "https://acme.wd5.myworkdayjobs.com/careers/job/123",
    canonicalUrl: "https://acme.wd5.myworkdayjobs.com/careers/job/123",
    mode: "LIVE",
  });
  assert.equal(created.ok, true);
  const blocked = sessions.markIntervention(created.session.id, "LOGIN_REQUIRED", "Sign in required", "Sign in, then resume.");
  assert.equal(blocked.status, "USER_INTERVENTION_REQUIRED");
  assert.equal(blocked.requiresUserAction, true);
  assert.equal(blocked.accountState, "ACCOUNT_EXISTS_LOGIN_REQUIRED");

  const resumed = sessions.resumeApplicationSession(created.session.id);
  assert.equal(resumed.ok, true);
  assert.equal(resumed.session.status, "SUBMITTING");
  assert.equal(resumed.session.requiresUserAction, false);
  assert.equal(resumed.session.accountState, "APPLICATION_READY");
});

test("no-submit guarantee: every adapter's submit returns a blocker (never submits)", async () => {
  const root = useRoot();
  const pkg = readyResumePackage(root);
  const inspected = inspectedForm({ fields: [] });
  for (const Adapter of [ashby.AshbyAdapter, workday.WorkdayAdapter, generic.GenericAtsAdapter]) {
    const blocker = await new Adapter().submit(ctxFor(pkg), inspected);
    assert.ok(blocker && typeof blocker.code === "string", `${Adapter.name} must block submission`);
  }
});

test("confirmation is required before SUBMITTED (captureConfirmation returns null)", async () => {
  const root = useRoot();
  const pkg = readyResumePackage(root);
  const inspected = inspectedForm({ fields: [] });
  for (const Adapter of [ashby.AshbyAdapter, workday.WorkdayAdapter, generic.GenericAtsAdapter]) {
    const confirmation = await new Adapter().captureConfirmation(ctxFor(pkg), inspected);
    assert.equal(confirmation, null);
  }
});

test("duplicate live execution protection remains intact for Ashby/Workday packages", () => {
  useRoot();
  for (const atsType of ["ashby", "workday"]) {
    const input = {
      userId: "u1",
      profileScope: "scope1",
      applicationPackageId: `pkg_${atsType}`,
      applicationPackageVersion: 1,
      applicationPackageHash: "hash-1",
      atsType,
      applicationUrl: "https://example.com/apply",
      canonicalUrl: "https://example.com/apply",
      mode: "LIVE",
    };
    assert.equal(sessions.createApplicationSession(input).ok, true);
    const second = sessions.createApplicationSession(input);
    assert.equal(second.ok, false);
    assert.equal(second.code, "DUPLICATE_SUBMISSION");
  }
});

test("auth/origin protections remain intact: anonymous status write is denied", async () => {
  useRoot();
  const req = new Request("http://localhost/api/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ n: "1", status: "Applied" }),
  });
  const res = await statusRoute.POST(req);
  assert.equal(res.status, 401);
});
