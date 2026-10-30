import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "./McpInvocationContext.ts";
import * as ThreadMetadataMcp from "./ThreadMetadataMcpService.ts";

const threadId = ThreadId.make("thread:metadata-caller");
const scope: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("environment:metadata-test"),
  requestNamespace: "provider-session:metadata-test",
  thread: {
    threadId,
    providerSessionId: "provider-session:metadata-test",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
  capabilities: new Set(["orchestration"]),
  issuedAt: 1,
};

function layerService(
  getThreadShell: ThreadManagement.ThreadManagementService["Service"]["getThreadShell"],
) {
  return ThreadMetadataMcp.layer.pipe(
    Layer.provide(
      Layer.merge(
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadShell,
          getThreadRecords: () => Effect.die("projection must not load after shell failure"),
        } satisfies Partial<ThreadManagement.ThreadManagementService["Service"]>),
        NodeCrypto.layer,
      ),
    ),
  );
}

it.effect("rejects project moves from a caller below full access before touching the target", () =>
  Effect.gen(function* () {
    const limitedScope: McpInvocationContext.McpInvocationScope = {
      ...scope,
      thread: undefined,
      client: { sessionId: "limited", label: "limited", access: "auto" },
    };
    const program = Effect.gen(function* () {
      const service = yield* ThreadMetadataMcp.ThreadMetadataMcpService;
      return yield* service.update(limitedScope, {
        action: "move_to_project",
        threadId,
        sourceProjectId: ProjectId.make("old"),
        targetProjectId: ProjectId.make("current"),
      });
    });
    const error = yield* program.pipe(
      Effect.provide(layerService(() => Effect.die("No target reads before authorization"))),
      Effect.flip,
    );
    expect(error.code).toBe("capability_denied");
  }),
);
