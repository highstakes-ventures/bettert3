import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { MarketingError, type Release } from "./contracts.ts";

const GitHubRelease = Schema.Struct({
  id: Schema.Number,
  tag_name: Schema.String,
  html_url: Schema.String,
  body: Schema.NullOr(Schema.String),
  draft: Schema.Boolean,
  prerelease: Schema.Boolean,
  published_at: Schema.NullOr(Schema.String),
});
const Promotion = Schema.Struct({
  id: Schema.Number,
  path: Schema.String,
  status: Schema.String,
  conclusion: Schema.NullOr(Schema.String),
  head_branch: Schema.NullOr(Schema.String),
  display_title: Schema.String,
  repository: Schema.Struct({ full_name: Schema.String }),
});
const Artifacts = Schema.Struct({
  artifacts: Schema.Array(
    Schema.Struct({ name: Schema.String, workflow_run: Schema.Struct({ id: Schema.Number }) }),
  ),
});
const decodeReleasePage = Schema.decodeUnknownEffect(Schema.Array(GitHubRelease));
const decodePromotion = Schema.decodeUnknownEffect(Promotion);
const decodeCommit = Schema.decodeUnknownEffect(
  Schema.Struct({ sha: Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/)) }),
);
const decodeArtifacts = Schema.decodeUnknownEffect(Artifacts);
export type GitHubReader<E, R> = (path: string) => Effect.Effect<unknown, E, R>;
/** A release is public content only after its production run and tag evidence agree. */
export const verifiedReleases = Effect.fn("marketing.verifiedReleases")(function* <E, R>(
  read: GitHubReader<E, R>,
  known: ReadonlySet<string>,
) {
  const releases: Array<typeof GitHubRelease.Type> = [];
  for (let page = 1; ; page++) {
    const batch = yield* decodeReleasePage(yield* read(`releases?per_page=100&page=${page}`));
    releases.push(...batch);
    if (batch.length < 100) break;
  }
  const candidates = releases
    .filter(
      (r) => !r.draft && !r.prerelease && r.published_at && /^v\d+\.\d+\.\d+$/.test(r.tag_name),
    )
    .sort((a, b) => Date.parse(a.published_at!) - Date.parse(b.published_at!));
  const unseen = candidates.filter((r) => !known.has(String(r.id)));
  const verified: Release[] = [];
  for (const release of unseen.toReversed()) {
    const runId =
      /^\[Production promotion\]\(https:\/\/github\.com\/recuut\/platform\/actions\/runs\/(\d+)\)\s*$/m.exec(
        release.body ?? "",
      )?.[1];
    if (!runId) continue;
    const run = yield* decodePromotion(yield* read(`actions/runs/${runId}`));
    if (
      String(run.id) !== runId ||
      run.repository.full_name !== "recuut/platform" ||
      ![
        ".github/workflows/deploy-production.yml",
        ".github/workflows/cd-deploy-production.yml",
      ].includes(run.path) ||
      run.head_branch !== "main" ||
      run.status !== "completed" ||
      run.conclusion !== "success" ||
      run.display_title !== `Promote ${release.tag_name} to production`
    )
      continue;
    const { sha } = yield* decodeCommit(
      yield* read(`commits/${encodeURIComponent(release.tag_name)}`),
    );
    const revisions = new Set<string>();
    for (let page = 1; ; page++) {
      const artifacts = yield* decodeArtifacts(
        yield* read(`actions/runs/${runId}/artifacts?per_page=100&page=${page}`),
      );
      for (const a of artifacts.artifacts) {
        const revision = /^environment-state-production-([a-f0-9]{40})$/.exec(a.name)?.[1];
        if (revision && a.workflow_run.id === run.id) revisions.add(revision);
      }
      if (artifacts.artifacts.length < 100) break;
    }
    if (revisions.size !== 1 || !revisions.has(sha))
      return yield* Effect.fail(
        new MarketingError(
          "invalid",
          `Production evidence does not match ${release.tag_name}'s tag.`,
        ),
      );
    const url = `https://github.com/recuut/platform/releases/tag/${release.tag_name}`;
    if (url !== release.html_url)
      return yield* Effect.fail(
        new MarketingError("invalid", "The release points outside recuut/platform."),
      );
    verified.push({
      id: String(release.id),
      tag: release.tag_name,
      url,
      revision: sha,
      publishedAt: release.published_at!,
      notes: release.body ?? "",
      productionRunUrl: `https://github.com/recuut/platform/actions/runs/${runId}`,
    });
  }
  return verified.toReversed();
});
