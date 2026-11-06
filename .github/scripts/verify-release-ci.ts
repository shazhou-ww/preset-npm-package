import assert from "node:assert/strict";

export const verificationContract = "Release verification (v1)";
export const verificationStep = "Confirm required checks succeeded";

interface VerificationOptions {
  apiUrl: string | undefined;
  repository: string | undefined;
  sha: string | undefined;
  token: string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function records(value: unknown): Record<string, unknown>[] {
  assert(Array.isArray(value), "Expected an array in CI evidence.");
  return value.map((item: unknown) => {
    assert(isRecord(item), "Expected an object in CI evidence.");
    return item;
  });
}

function positiveInteger(value: unknown): number {
  assert(
    typeof value === "number" && Number.isSafeInteger(value) && value > 0,
    "Expected a positive integer in CI evidence.",
  );
  return value;
}

export async function verifyReleaseCi(
  { apiUrl, repository, sha, token }: VerificationOptions,
  request: typeof fetch = fetch,
) {
  assert(apiUrl, "GITHUB_API_URL is required.");
  assert(
    repository && /^[\w.-]+\/[\w.-]+$/u.test(repository),
    "GITHUB_REPOSITORY must identify an owner/repository.",
  );
  assert(
    sha && /^[a-f\d]{40}$/u.test(sha),
    "Expected a full source commit SHA.",
  );
  assert(token, "A GitHub token with actions: read is required.");

  const base = `${apiUrl}/repos/${repository}/actions`;
  const runsUrl = `${base}/workflows/ci.yaml/runs?${new URLSearchParams({
    head_sha: sha,
    branch: "main",
    event: "push",
    per_page: "1",
  }).toString()}`;

  async function get(url: string) {
    const response = await request(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    assert(
      response.ok,
      `GitHub CI evidence request failed: HTTP ${response.status} ${response.statusText}`,
    );
    const data: unknown = await response.json();
    assert(isRecord(data), "Invalid GitHub CI evidence response.");
    return data;
  }

  async function latestRun() {
    const data = await get(runsUrl);
    const runs = records(data.workflow_runs);
    assert.equal(runs.length, 1, "No unique latest main push CI run found.");
    const run = runs[0];
    assert(run);
    assert(isRecord(run.repository), "Missing CI repository.");
    assert(isRecord(run.head_repository), "Missing CI source repository.");
    assert.equal(run.repository.full_name, repository, "Wrong CI repository.");
    assert.equal(
      run.head_repository.full_name,
      repository,
      "Wrong CI source repository.",
    );
    assert.equal(run.head_sha, sha, "Wrong CI source SHA.");
    assert.equal(run.head_branch, "main", "Wrong CI branch.");
    assert.equal(run.event, "push", "Wrong CI event.");
    assert.equal(run.path, ".github/workflows/ci.yaml", "Wrong CI workflow.");
    assert.equal(run.status, "completed", "Latest CI run is not completed.");
    assert.equal(run.conclusion, "success", "Latest CI run did not succeed.");
    assert(
      typeof run.html_url === "string" && run.html_url.length > 0,
      "Missing CI run URL.",
    );
    return {
      id: positiveInteger(run.id),
      attempt: positiveInteger(run.run_attempt),
      url: run.html_url,
    };
  }

  const run = await latestRun();
  const jobs: Record<string, unknown>[] = [];
  let page = 1;
  let total: number;
  do {
    const data = await get(
      `${base}/runs/${run.id}/attempts/${run.attempt}/jobs?per_page=100&page=${page}`,
    );
    assert(
      typeof data.total_count === "number" &&
        Number.isSafeInteger(data.total_count) &&
        data.total_count >= 0,
      "Invalid CI job count.",
    );
    total = data.total_count;
    const batch = records(data.jobs);
    assert(batch.length > 0, "Missing CI jobs.");
    jobs.push(...batch);
    assert(jobs.length <= total, "Inconsistent CI job count.");
    page++;
  } while (jobs.length < total);

  const matches = jobs.filter((job) => job.name === verificationContract);
  assert.equal(
    matches.length,
    1,
    "Missing or ambiguous verification contract.",
  );
  const job = matches[0];
  assert(job);
  assert.equal(job.run_id, run.id, "Verification job belongs to another run.");
  assert.equal(
    job.run_attempt,
    run.attempt,
    "Verification job belongs to another attempt.",
  );
  assert.equal(job.head_sha, sha, "Verification job has the wrong source SHA.");
  assert.equal(job.status, "completed", "Verification job is incomplete.");
  assert.equal(job.conclusion, "success", "Verification job did not succeed.");
  const steps = records(job.steps).filter(
    (step) => step.name === verificationStep,
  );
  assert.equal(steps.length, 1, "Missing or ambiguous verification step.");
  const step = steps[0];
  assert(step);
  assert.equal(step.status, "completed", "Verification step is incomplete.");
  assert.equal(
    step.conclusion,
    "success",
    "Verification step did not succeed.",
  );

  const current = await latestRun();
  assert.equal(
    current.id,
    run.id,
    "Latest CI run changed during verification.",
  );
  assert.equal(
    current.attempt,
    run.attempt,
    "Latest CI attempt changed during verification.",
  );

  return {
    sourceSha: sha,
    runUrl: run.url,
    runId: run.id,
    runAttempt: run.attempt,
    contract: verificationContract,
  };
}
