import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": path.resolve("src") } });
const session = jiti("./src/lib/apply/session.ts");
const adapters = jiti("./src/lib/command-center/ats-executor/adapters.ts");

// Isolate the browser-env signals for each case (restore afterwards).
function withEnv(env, fn) {
  const keys = ["CAREER_OPS_BROWSER", "DISPLAY", "WAYLAND_DISPLAY"];
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  try {
    return fn();
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

const isLinux = process.platform === "linux";

test("headless server (no DISPLAY) selects headless Chromium", () => {
  withEnv({}, () => {
    if (isLinux) {
      assert.equal(session.canUseHeadedBrowser(), false);
      assert.equal(session.resolveBrowserMode(), "headless");
    } else {
      // macOS/Windows have a native window server; the explicit override still works.
      assert.equal(session.canUseHeadedBrowser(), true);
    }
  });
});

test("explicit CAREER_OPS_BROWSER=headless forces headless even with a display", () => {
  withEnv({ CAREER_OPS_BROWSER: "headless", DISPLAY: ":0" }, () => {
    assert.equal(session.resolveBrowserMode(), "headless");
  });
});

test("headed environment (display present) can still select headed mode", () => {
  withEnv({ DISPLAY: ":0" }, () => {
    assert.equal(session.canUseHeadedBrowser(), true);
    assert.equal(session.resolveBrowserMode(), "headed");
  });
  withEnv({ WAYLAND_DISPLAY: "wayland-0" }, () => {
    assert.equal(session.resolveBrowserMode(), "headed");
  });
});

test("explicit CAREER_OPS_BROWSER=headed forces headed", () => {
  withEnv({ CAREER_OPS_BROWSER: "headed" }, () => {
    assert.equal(session.resolveBrowserMode(), "headed");
  });
});

test("missing DISPLAY is NOT reported as a missing-Chrome error", () => {
  // A generic launch failure while headed on a display-less box → no-display, and
  // the message must not tell the user to install Chrome.
  const err = session.classifyLaunchError(new Error("Failed to launch: something went wrong"), "headed", false);
  assert.equal(err.reason, "no-display");
  assert.doesNotMatch(err.message, /install .*(chrome|chromium)/i);
  assert.doesNotMatch(err.message, /needs Google Chrome/i);
});

test("genuine missing browser gets an accurate executable-missing error", () => {
  const raw = new Error(
    "browserType.launch: Executable doesn't exist at /root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome\nPlease run the following command to download new browsers:\nnpx playwright install",
  );
  const err = session.classifyLaunchError(raw, "headless");
  assert.equal(err.reason, "executable-missing");
  assert.match(err.message, /playwright install chromium/i);
});

test("classified errors never leak absolute server paths", () => {
  const raw = new Error("Executable doesn't exist at /root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome");
  for (const mode of ["headed", "headless"]) {
    const err = session.classifyLaunchError(raw, mode, false);
    assert.doesNotMatch(err.message, /\/root\/|\/home\/|\.cache|ms-playwright/);
  }
});

test("a plain launch failure (browser present, display present) is launch-failed", () => {
  const err = session.classifyLaunchError(new Error("Target page, context or browser has been closed"), "headless", true);
  assert.equal(err.reason, "launch-failed");
});

test("BrowserLaunchError passes through classifyLaunchError unchanged", () => {
  const original = new session.BrowserLaunchError("executable-missing", "already classified");
  assert.equal(session.classifyLaunchError(original, "headless"), original);
});

test("human handoff is only possible in headed mode", () => {
  withEnv({ CAREER_OPS_BROWSER: "headless" }, () => {
    assert.equal(session.canHandoffToHuman(), false);
  });
  withEnv({ CAREER_OPS_BROWSER: "headed" }, () => {
    assert.equal(session.canHandoffToHuman(), true);
  });
});

test("dry run remains no-submit regardless of browser mode (submit blocks, no confirmation)", async () => {
  // Browser mode is orthogonal to the submit safety gate: every adapter still
  // refuses to submit and never fabricates a confirmation.
  const ctx = {
    session: { canonicalUrl: "https://boards.greenhouse.io/acme/jobs/1" },
    pkg: { selectedResume: { id: "r", version: 1 }, userId: "u", profileScope: "s", questions: [], company: "Acme" },
    mode: "DRY_RUN",
    dryRunFill: false,
  };
  const inspected = { title: "", url: ctx.session.canonicalUrl, fields: [], issues: [] };
  const adapter = adapters.adapterForUrl(new URL(ctx.session.canonicalUrl));
  const submitBlocker = await adapter.submit(ctx, inspected);
  assert.notEqual(submitBlocker, null);
  assert.equal(await adapter.captureConfirmation(ctx, inspected), null);
});
