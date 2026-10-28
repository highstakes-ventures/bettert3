import { RuntimeRequestId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";
import { isAutomaticThread, threadNeedsUserAttention } from "./threadAttention.ts";

describe("automatic chat attention", () => {
  const independent = { automationOrigin: "external" as const, backgroundWorkflowId: "mation-run" };
  it("keeps independent work quiet and leaves ordinary decision discussions in the inbox", () => {
    expect(isAutomaticThread(independent)).toBe(true);
    expect(threadNeedsUserAttention(independent)).toBe(false);
    expect(isAutomaticThread({})).toBe(false);
  });
  it.each([
    "user_input",
    "command",
    "file-change",
    "file-read",
    "permission",
    "mcp-elicitation",
  ] as const)("surfaces a pending %s request until it is resolved", (kind) => {
    const waiting = {
      ...independent,
      pendingRuntimeRequest: {
        id: RuntimeRequestId.make("waiting"),
        kind,
        createdAt: DateTime.makeUnsafe("2026-10-28T10:00:00Z"),
      },
    };
    expect(threadNeedsUserAttention(waiting)).toBe(true);
    expect(isAutomaticThread(waiting)).toBe(false);
    expect(isAutomaticThread({ ...waiting, pendingRuntimeRequest: null })).toBe(true);
  });
  it("surfaces published email review while preserving its automation attribution", () => {
    const email = { ...independent, hasEmailReview: true };
    expect(isAutomaticThread(email)).toBe(false);
    expect(isAutomaticThread({ ...email, hasEmailReview: false })).toBe(true);
    expect(email.automationOrigin).toBe("external");
  });
  it("does not treat provider authentication refresh as a human decision", () => {
    expect(
      isAutomaticThread({
        ...independent,
        pendingRuntimeRequest: {
          id: RuntimeRequestId.make("refresh"),
          kind: "auth_refresh",
          createdAt: DateTime.makeUnsafe("2026-10-28T10:00:00Z"),
        },
      }),
    ).toBe(true);
  });
});
