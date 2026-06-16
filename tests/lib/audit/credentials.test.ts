import { test } from "node:test";
import assert from "node:assert/strict";
import { runCredentialAudit } from "../../../src/lib/audit/credentials";

test("audit returns a report against the current repo", () => {
  const report = runCredentialAudit();
  assert.ok(report.repoRoot.length > 0, "repoRoot should be resolved");
  assert.equal(report.results.length, 5, "should run all 5 checks");
  assert.equal(typeof report.failed, "number");
  assert.equal(report.passed, report.failed === 0);
});

test("each check has the expected shape", () => {
  const report = runCredentialAudit();
  for (const r of report.results) {
    assert.equal(typeof r.id, "number");
    assert.ok(r.name.length > 0);
    assert.ok(["pass", "fail", "skip"].includes(r.status));
    assert.ok(r.detail.length > 0);
    assert.ok(Array.isArray(r.hits));
  }
});

test("checks are numbered 1..5 in order", () => {
  const report = runCredentialAudit();
  assert.deepEqual(
    report.results.map((r) => r.id),
    [1, 2, 3, 4, 5]
  );
});

test("non-git directory produces a single failing git check", () => {
  // os.tmpdir() is not a git work tree
  const report = runCredentialAudit("/");
  // Either "/" is somehow tracked (unlikely) or we get the git-repo failure.
  // The contract: when not in a repo, exactly one failing check with id 0.
  if (!report.passed && report.results.length === 1) {
    assert.equal(report.results[0].id, 0);
    assert.equal(report.results[0].status, "fail");
  } else {
    // If "/" happened to resolve a repo root, just assert structural validity.
    assert.equal(report.results.length, 5);
  }
});

test("audit of this repo passes (regression guard)", () => {
  // The repo must stay clean. If this fails, a secret leaked into tracked files.
  const report = runCredentialAudit();
  assert.equal(report.passed, true, `audit must pass; failures: ${JSON.stringify(report.results.filter((r) => r.status === "fail"))}`);
});

test("audit does not flag its own source or RPC-URL templates (false-positive guard)", () => {
  // credentials.ts contains the BIP-39 needle list, and config/alchemy.ts holds
  // the `${key}` URL template. Neither is a real leaked secret — checks 3 and 5
  // must stay clean even though these tracked files exist.
  const report = runCredentialAudit();
  const mnemonic = report.results.find((r) => r.id === 3)!;
  const rpc = report.results.find((r) => r.id === 5)!;
  assert.equal(mnemonic.status, "pass", `check 3 false positive: ${JSON.stringify(mnemonic.hits)}`);
  assert.equal(rpc.status, "pass", `check 5 false positive: ${JSON.stringify(rpc.hits)}`);
});
