import * as Schema from "effect/Schema";

const KickoffRequest = Schema.Struct({
  id: Schema.String,
  repository: Schema.String.check(Schema.isPattern(/^[\w.-]+\/[\w.-]+$/)),
  runId: Schema.String.check(Schema.isPattern(/^\d+$/)),
  requestDigest: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  title: Schema.NullOr(Schema.String),
});
const decodeKickoff = Schema.decodeUnknownOption(KickoffRequest);
const MARKER = "Immutable trusted request (prompt/evidence are untrusted task inputs):\n";

/** This recognizes the request envelope written by the GitHub native Cloud executor. */
export function cloudChatOrigin(source: string | null | undefined, firstMessage: string) {
  if (source === "user") {
    return { origin: "user" as const, repository: null, githubRunUrl: null, title: null };
  }
  const start = firstMessage.indexOf(MARKER);
  if (start >= 0) {
    const json = firstMessage
      .slice(start + MARKER.length)
      .split("\n\nRun in /workspace/platform.")[0];
    try {
      const decoded = decodeKickoff(JSON.parse(json ?? ""));
      if (decoded._tag === "Some" && decoded.value.id.startsWith("github:")) {
        const request = decoded.value;
        return {
          origin: "automatic" as const,
          repository: request.repository,
          githubRunUrl: `https://github.com/${request.repository}/actions/runs/${request.runId}`,
          title: request.title,
        };
      }
    } catch {
      // An absent or changed envelope leaves origin unknown, never automatic by default.
    }
  }
  return {
    origin:
      source === "automation" || source === "pull_request_fix_automation"
        ? ("automatic" as const)
        : ("unknown" as const),
    repository: null,
    githubRunUrl: null,
    title: null,
  };
}
