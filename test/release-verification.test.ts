import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  verificationContract,
  verificationStep,
  verifyReleaseCi,
} from "../.github/scripts/verify-release-ci.js";

const sha = "a".repeat(40);
const options = {
  apiUrl: "https://api.github.com",
  repository: "example/package",
  sha,
  token: "test-token",
};

function successfulRun() {
  return {
    id: 42,
    run_attempt: 2,
    repository: { full_name: options.repository },
    head_repository: { full_name: options.repository },
    head_sha: sha,
    head_branch: "main",
    event: "push",
    path: ".github/workflows/ci.yaml",
    status: "completed",
    conclusion: "success",
    html_url: "https://github.com/example/package/actions/runs/42",
  };
}

function successfulJob() {
  return {
    name: verificationContract,
    run_id: 42,
    run_attempt: 2,
    head_sha: sha,
    status: "completed",
    conclusion: "success",
    steps: [
      {
        name: verificationStep,
        status: "completed",
        conclusion: "success",
      },
    ],
  };
}

function responses(...bodies: unknown[]) {
  const request = vi
    .fn<typeof fetch>()
    .mockRejectedValue(new Error("Unexpected API request."));
  for (const body of bodies) {
    request.mockResolvedValueOnce(Response.json(body));
  }
  return request;
}

function evidence(
  run: object = successfulRun(),
  jobs: object[] = [successfulJob()],
  current: object = run,
) {
  return responses(
    { workflow_runs: [run] },
    { total_count: jobs.length, jobs },
    { workflow_runs: [current] },
  );
}

describe("release CI evidence", () => {
  it("accepts only the exact main push run and its successful contract attempt", async () => {
    const request = evidence();
    await expect(verifyReleaseCi(options, request)).resolves.toEqual({
      sourceSha: sha,
      runUrl: successfulRun().html_url,
      runId: 42,
      runAttempt: 2,
      contract: verificationContract,
    });
    const urls = request.mock.calls.map(
      ([url]) => new URL(url instanceof Request ? url.url : url),
    );
    expect(urls[0]?.pathname).toBe(
      "/repos/example/package/actions/workflows/ci.yaml/runs",
    );
    expect(Object.fromEntries(urls[0]?.searchParams ?? [])).toEqual({
      head_sha: sha,
      branch: "main",
      event: "push",
      per_page: "1",
    });
    expect(urls[1]?.pathname).toBe(
      "/repos/example/package/actions/runs/42/attempts/2/jobs",
    );
    expect(urls[2]?.href).toBe(urls[0]?.href);
    expect(request.mock.calls[0]?.[1]?.headers).toEqual({
      Accept: "application/vnd.github+json",
      Authorization: "Bearer test-token",
      "X-GitHub-Api-Version": "2022-11-28",
    });
  });

  it.each([
    ["apiUrl", undefined, "GITHUB_API_URL"],
    ["repository", undefined, "owner/repository"],
    ["repository", "not-a-repository", "owner/repository"],
    ["sha", "short-sha", "full source commit SHA"],
    ["sha", undefined, "full source commit SHA"],
    ["token", undefined, "actions: read"],
  ] as const)(
    "rejects invalid %s before requesting evidence",
    async (key, value, message) => {
      const request = evidence();
      await expect(
        verifyReleaseCi({ ...options, [key]: value }, request),
      ).rejects.toThrow(message);
      expect(request).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["repository", null, "Missing CI repository"],
    ["repository", { full_name: "other/package" }, "Wrong CI repository"],
    ["head_repository", null, "Missing CI source repository"],
    [
      "head_repository",
      { full_name: "fork/package" },
      "Wrong CI source repository",
    ],
    ["head_sha", "b".repeat(40), "Wrong CI source SHA"],
    ["head_branch", "feature", "Wrong CI branch"],
    ["event", "pull_request", "Wrong CI event"],
    ["event", "workflow_dispatch", "Wrong CI event"],
    ["path", ".github/workflows/other.yaml", "Wrong CI workflow"],
    ["status", "queued", "not completed"],
    ["status", "in_progress", "not completed"],
    ["conclusion", "failure", "did not succeed"],
    ["conclusion", "cancelled", "did not succeed"],
    ["conclusion", "skipped", "did not succeed"],
    ["conclusion", "neutral", "did not succeed"],
    ["conclusion", null, "did not succeed"],
    ["id", 0, "positive integer"],
    ["run_attempt", 1.5, "positive integer"],
    ["html_url", "", "Missing CI run URL"],
  ] as const)("rejects invalid run %s (%j)", async (key, value, message) => {
    const request = evidence({ ...successfulRun(), [key]: value });
    await expect(verifyReleaseCi(options, request)).rejects.toThrow(message);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["name", "Release verification (v0)", "verification contract"],
    ["run_id", 41, "another run"],
    ["run_attempt", 1, "another attempt"],
    ["head_sha", "b".repeat(40), "wrong source SHA"],
    ["status", "in_progress", "job is incomplete"],
    ["conclusion", "failure", "job did not succeed"],
    ["conclusion", "cancelled", "job did not succeed"],
    ["conclusion", "skipped", "job did not succeed"],
    ["steps", [], "verification step"],
    ["steps", null, "Expected an array"],
  ] as const)(
    "rejects invalid verification job %s (%j)",
    async (key, value, message) => {
      await expect(
        verifyReleaseCi(
          options,
          evidence(successfulRun(), [{ ...successfulJob(), [key]: value }]),
        ),
      ).rejects.toThrow(message);
    },
  );

  it.each([
    ["name", "Old verification step", "verification step"],
    ["status", "queued", "step is incomplete"],
    ["conclusion", "skipped", "step did not succeed"],
    ["conclusion", "failure", "step did not succeed"],
    ["conclusion", "cancelled", "step did not succeed"],
  ] as const)(
    "rejects invalid verification step %s (%j)",
    async (key, value, message) => {
      const job = successfulJob();
      job.steps = job.steps.map((step) => ({ ...step, [key]: value }));
      await expect(
        verifyReleaseCi(options, evidence(successfulRun(), [job])),
      ).rejects.toThrow(message);
    },
  );

  it("rejects duplicate contract jobs and duplicate verification steps", async () => {
    await expect(
      verifyReleaseCi(
        options,
        evidence(successfulRun(), [successfulJob(), successfulJob()]),
      ),
    ).rejects.toThrow("ambiguous verification contract");
    const job = successfulJob();
    job.steps.push(...job.steps);
    await expect(
      verifyReleaseCi(options, evidence(successfulRun(), [job])),
    ).rejects.toThrow("ambiguous verification step");
  });

  it.each([
    null,
    [],
    {},
    { workflow_runs: null },
    { workflow_runs: [null] },
    { workflow_runs: [] },
    { workflow_runs: [successfulRun(), successfulRun()] },
  ])("rejects missing or malformed run evidence (%j)", async (body) => {
    await expect(verifyReleaseCi(options, responses(body))).rejects.toThrow();
  });

  it.each([
    { total_count: -1, jobs: [] },
    { total_count: "1", jobs: [successfulJob()] },
    { total_count: 0, jobs: [] },
    { total_count: 0, jobs: [successfulJob()] },
    { total_count: 1, jobs: null },
    { total_count: 1, jobs: [null] },
  ])("rejects missing or malformed job evidence (%j)", async (body) => {
    await expect(
      verifyReleaseCi(
        options,
        responses({ workflow_runs: [successfulRun()] }, body),
      ),
    ).rejects.toThrow();
  });

  it("paginates jobs within the exact attempt", async () => {
    const run = successfulRun();
    const request = responses(
      { workflow_runs: [run] },
      {
        total_count: 101,
        jobs: Array.from({ length: 100 }, (_, index) => ({
          name: `Other job ${index}`,
        })),
      },
      { total_count: 101, jobs: [successfulJob()] },
      { workflow_runs: [run] },
    );
    await expect(verifyReleaseCi(options, request)).resolves.toMatchObject({
      runAttempt: 2,
    });
    expect(request.mock.calls[2]?.[0]).toContain(
      "/runs/42/attempts/2/jobs?per_page=100&page=2",
    );
  });

  it("rejects truncated job pagination", async () => {
    await expect(
      verifyReleaseCi(
        options,
        responses(
          { workflow_runs: [successfulRun()] },
          { total_count: 2, jobs: [successfulJob()] },
          { total_count: 2, jobs: [] },
        ),
      ),
    ).rejects.toThrow("Missing CI jobs");
  });

  it.each([
    ["id", 43, "Latest CI run changed"],
    ["run_attempt", 3, "Latest CI attempt changed"],
    ["status", "in_progress", "not completed"],
    ["conclusion", "failure", "did not succeed"],
  ] as const)(
    "rejects evidence changing during verification (%s)",
    async (key, value, message) => {
      const run = successfulRun();
      await expect(
        verifyReleaseCi(
          options,
          evidence(run, [successfulJob()], { ...run, [key]: value }),
        ),
      ).rejects.toThrow(message);
    },
  );

  it("never searches for an older success after the latest run fails", async () => {
    const request = responses(
      { workflow_runs: [{ ...successfulRun(), conclusion: "failure" }] },
      { workflow_runs: [successfulRun()] },
    );
    await expect(verifyReleaseCi(options, request)).rejects.toThrow(
      "Latest CI run did not succeed",
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403, 404, 429, 500])(
    "fails explicitly on HTTP %s",
    async (status) => {
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("API failure", { status }));
      await expect(verifyReleaseCi(options, request)).rejects.toThrow(
        `HTTP ${status}`,
      );
      expect(request).toHaveBeenCalledTimes(1);
    },
  );

  it("propagates network and malformed JSON errors", async () => {
    const network = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("Network unavailable"));
    await expect(verifyReleaseCi(options, network)).rejects.toThrow(
      "Network unavailable",
    );
    const invalidJson = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("invalid JSON"));
    await expect(verifyReleaseCi(options, invalidJson)).rejects.toThrow(
      SyntaxError,
    );
  });

  it("does not accept an API failure after reading successful run evidence", async () => {
    const request = responses({ workflow_runs: [successfulRun()] });
    request.mockResolvedValueOnce(new Response("", { status: 403 }));
    await expect(verifyReleaseCi(options, request)).rejects.toThrow("HTTP 403");
    const recheck = responses(
      { workflow_runs: [successfulRun()] },
      { total_count: 1, jobs: [successfulJob()] },
    );
    recheck.mockRejectedValueOnce(new Error("Recheck unavailable"));
    await expect(verifyReleaseCi(options, recheck)).rejects.toThrow(
      "Recheck unavailable",
    );
  });
});

describe("release workflow wiring", () => {
  const ci = readFileSync(
    new URL("../.github/workflows/ci.yaml", import.meta.url),
    "utf8",
  );
  const publish = readFileSync(
    new URL("../.github/workflows/publish-npm.yaml", import.meta.url),
    "utf8",
  );

  it("requires the matrix and a non-skipped versioned aggregate", () => {
    expect(ci).toContain("run: pnpm check");
    expect(ci).toContain(`name: ${verificationContract}`);
    expect(ci).toContain(`name: ${verificationStep}`);
    expect(ci).toContain("needs: check\n    if: always()");
    expect(ci).toContain("CHECK_RESULT: ${{ needs.check.result }}");
    expect(ci).toContain('if [ "$CHECK_RESULT" != "success" ]; then');
    expect(ci).not.toContain("continue-on-error");
  });

  it("gates both publication paths on the checked-out SHA and records evidence", () => {
    expect(publish).toContain("actions: read");
    expect(publish).toContain('["rev-parse", "HEAD"]');
    expect(publish).toContain("const evidence = await verifyReleaseCi(");
    expect(publish).toContain("GITHUB_STEP_SUMMARY");
    for (const field of ["sourceSha", "runUrl", "runAttempt", "contract"]) {
      expect(publish).toContain(`evidence.${field}`);
    }
    expect(publish.indexOf("Verify exact-commit main CI")).toBeLessThan(
      publish.indexOf("Build and pack package once"),
    );
    expect(publish).not.toContain("continue-on-error");
    expect(publish).not.toContain("pnpm check");
  });

  it("initializes the artifact path in a step where runner variables exist", () => {
    expect(publish).not.toContain("${{ runner.temp }}");
    expect(publish).toContain(
      '- name: Build and pack package once\n        run: |\n          PACKAGE_TARBALL="$RUNNER_TEMP/release-package.tgz"',
    );
    expect(publish).toContain(
      'echo "PACKAGE_TARBALL=$PACKAGE_TARBALL" >> "$GITHUB_ENV"',
    );
  });

  it("builds once and validates and publishes the same tarball", () => {
    expect(publish).toContain('pnpm pack --out "$PACKAGE_TARBALL"');
    expect(publish).toContain('pnpm exec publint "$PACKAGE_TARBALL"');
    expect(publish.match(/npm publish "\$PACKAGE_TARBALL"/gu)).toHaveLength(2);
    expect(publish).not.toMatch(/run: pnpm build/u);
    expect(publish.indexOf("Set temporary dry-run version")).toBeLessThan(
      publish.indexOf("Build and pack package once"),
    );
    expect(publish.indexOf("Validate package artifact")).toBeLessThan(
      publish.indexOf("- name: Publish package"),
    );
    for (const safeguard of [
      "packageJson.private === true",
      'packageJson.name === "preset-npm-package"',
      "stableVersion.test(packageJson.version)",
      "process.env.RELEASE_TAG !== expectedTag",
      "git merge-base --is-ancestor",
      "Reject an existing npm version",
      "pnpm install --frozen-lockfile",
      "id-token: write",
      "environment: npm",
      "workflow_dispatch",
      "--dry-run",
    ]) {
      expect(publish).toContain(safeguard);
    }
  });
});
