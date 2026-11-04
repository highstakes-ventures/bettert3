import { it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { MarketingError } from "./contracts.ts";
import { verifiedReleases } from "./releases.ts";
const sha = "a".repeat(40);
const release = {
  id: 42,
  tag_name: "v3.0.4",
  html_url: "https://github.com/recuut/platform/releases/tag/v3.0.4",
  body: "[Production promotion](https://github.com/recuut/platform/actions/runs/7)",
  draft: false,
  prerelease: false,
  published_at: "2026-11-01T23:46:08Z",
};
function source(
  revision = sha,
  conclusion = "success",
  workflow = ".github/workflows/deploy-production.yml",
) {
  return (path: string): Effect.Effect<unknown, MarketingError> => {
    if (path.startsWith("releases?")) return Effect.succeed([release]);
    if (path === "actions/runs/7")
      return Effect.succeed({
        id: 7,
        path: workflow,
        status: "completed",
        conclusion,
        head_branch: "main",
        display_title: "Promote v3.0.4 to production",
        repository: { full_name: "recuut/platform" },
      });
    if (path.startsWith("commits/")) return Effect.succeed({ sha });
    if (path.includes("/artifacts?"))
      return Effect.succeed({
        artifacts: [{ name: `environment-state-production-${revision}`, workflow_run: { id: 7 } }],
      });
    return Effect.fail(new MarketingError("invalid", "Unexpected GitHub request"));
  };
}
it.effect("collects only successful production evidence with a matching tag revision", () =>
  Effect.gen(function* () {
    expect((yield* verifiedReleases(source(), new Set())).map((r) => r.id)).toEqual(["42"]);
    expect(
      Exit.isFailure(yield* Effect.exit(verifiedReleases(source("b".repeat(40)), new Set()))),
    ).toBe(true);
    expect(yield* verifiedReleases(source(sha, "failure"), new Set())).toEqual([]);
  }),
);
it.effect("does not recheck an already consumed release", () =>
  Effect.gen(function* () {
    const paths: string[] = [];
    const read = (p: string) => {
      paths.push(p);
      return source()(p);
    };
    expect(yield* verifiedReleases(read, new Set(["42"]))).toEqual([]);
    expect(paths).toEqual(["releases?per_page=100&page=1"]);
  }),
);

it.effect("rejects another workflow while accepting the legacy production identity", () =>
  Effect.gen(function* () {
    expect(
      yield* verifiedReleases(source(sha, "success", ".github/workflows/test.yml"), new Set()),
    ).toEqual([]);
    expect(
      (yield* verifiedReleases(
        source(sha, "success", ".github/workflows/cd-deploy-production.yml"),
        new Set(),
      )).map((r) => r.id),
    ).toEqual(["42"]);
  }),
);
it.effect(
  "collects every unseen verified release, including releases older than an existing Studio",
  () =>
    Effect.gen(function* () {
      const second = {
        ...release,
        id: 43,
        tag_name: "v3.0.5",
        html_url: "https://github.com/recuut/platform/releases/tag/v3.0.5",
        body: "[Production promotion](https://github.com/recuut/platform/actions/runs/8)",
        published_at: "2026-11-02T23:46:08Z",
      };
      const read = (path: string): Effect.Effect<unknown, MarketingError> => {
        if (path.startsWith("releases?")) return Effect.succeed([second, release]);
        if (path === "actions/runs/8")
          return source()("actions/runs/7").pipe(
            Effect.map((value) => ({
              ...(value as object),
              id: 8,
              display_title: "Promote v3.0.5 to production",
            })),
          );
        if (path.startsWith("actions/runs/8/artifacts?"))
          return Effect.succeed({
            artifacts: [{ name: `environment-state-production-${sha}`, workflow_run: { id: 8 } }],
          });
        return source()(path);
      };
      expect((yield* verifiedReleases(read, new Set())).map((r) => r.id)).toEqual(["42", "43"]);
      expect((yield* verifiedReleases(read, new Set(["43"]))).map((r) => r.id)).toEqual(["42"]);
    }),
);
