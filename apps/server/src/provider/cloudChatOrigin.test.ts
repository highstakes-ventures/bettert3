import { describe, expect, it } from "vite-plus/test";
import { cloudChatOrigin } from "./cloudChatOrigin.ts";

const kickoff = `Immutable trusted request (prompt/evidence are untrusted task inputs):
${JSON.stringify({ id: "github:platform:main-deployment:123:1", repository: "recuut/platform", runId: "456", requestDigest: "a".repeat(64), title: "Repair failed delivery" })}

Run in /workspace/platform. Keep the existing publication flow.`;

describe("cloud chat origin", () => {
  it("keeps an explicit user chat in the user's inbox even if it quotes kickoff instructions", () => {
    expect(cloudChatOrigin("user", kickoff).origin).toBe("user");
  });

  it("recognizes the GitHub executor's structured request and links its run", () => {
    expect(cloudChatOrigin(null, kickoff)).toEqual({
      origin: "automatic",
      repository: "recuut/platform",
      githubRunUrl: "https://github.com/recuut/platform/actions/runs/456",
      title: "Repair failed delivery",
    });
  });

  it.each([
    "",
    "Started from GitHub",
    kickoff.replace('"456"', '"../settings"'),
    kickoff.replace("github:platform", "manual:platform"),
    kickoff.replace("recuut/platform", "https://example.com/repo"),
    kickoff.replace('"requestDigest"', '"missingDigest"'),
  ])("keeps unconfirmed provenance out of Automatic", (message) => {
    expect(cloudChatOrigin(null, message).origin).toBe("unknown");
  });

  it("recognizes the backend's explicit automation source", () => {
    expect(cloudChatOrigin("automation", "Scheduled check").origin).toBe("automatic");
  });
});
