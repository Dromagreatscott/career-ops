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
