import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
    expect(ci).toContain("name: Release verification (v1)");
    expect(ci).toContain("name: Confirm required checks succeeded");
    expect(ci).toContain("needs: check\n    if: always()");
    expect(ci).toContain("CHECK_RESULT: ${{ needs.check.result }}");
    expect(ci).toContain('if [ "$CHECK_RESULT" != "success" ]; then');
    expect(ci).not.toContain("continue-on-error");
  });

  it("uses the locked CLI to gate both publication paths and record evidence", () => {
    expect(publish).toContain("actions: read");
    expect(publish).toContain("GH_TOKEN: ${{ github.token }}");
    expect(publish).toContain("pnpm exec github-ci-verify");
    expect(publish).toContain('--sha "$(git rev-parse HEAD)"');
    expect(publish).toContain("--branch main");
    expect(publish).toContain("--workflow ci.yaml");
    expect(publish).toContain('--job-name "Release verification (v1)"');
    expect(publish).toContain(
      '--step-name "Confirm required checks succeeded"',
    );
    expect(publish).toContain("--json --summary");
    expect(publish.indexOf("pnpm install --frozen-lockfile")).toBeLessThan(
      publish.indexOf("pnpm exec github-ci-verify"),
    );
    expect(publish).toContain(
      "- name: Verify exact-commit main CI\n        env:",
    );
    expect(publish.indexOf("Verify exact-commit main CI")).toBeLessThan(
      publish.indexOf("Set temporary dry-run version"),
    );
    expect(publish).not.toContain("continue-on-error");
    expect(publish).not.toContain("pnpm check");
    expect(publish).not.toContain("verify-release-ci.ts");
    expect(publish).not.toContain("--experimental-strip-types");
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
