import { it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { McpSchema, McpServer } from "effect/ai";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import type { Draft } from "@highstakes/marketing/contracts";
import * as Marketing from "../../../marketing/MarketingService.ts";
import * as Invocation from "../../McpInvocationContext.ts";
import * as Testkit from "../../McpToolAccess.testkit.ts";
import { toolkitRegistration, layerInProcessMcpServer } from "../../McpHttpServer.ts";
import { MarketingToolkit } from "./tools.ts";
import { layer } from "./handlers.ts";

it.effect("returns media metadata without image bytes from both Studio tools", () =>
  Effect.gen(function* () {
    const draft: Draft = {
      id: "42",
      revision: 1,
      projectId: "project",
      threadId: "thread",
      release: {
        id: "42",
        tag: "v3.0.4",
        url: "https://github.com/recuut/platform/releases/tag/v3.0.4",
        revision: "a".repeat(40),
        publishedAt: "2026-11-01T23:46:08Z",
        notes: "Fixture",
        productionRunUrl: "https://github.com/recuut/platform/actions/runs/7",
      },
      stage: "selecting",
      highlights: null,
      selectionApproved: false,
      company: { text: "", author: "" },
      personal: { text: "", author: "", enabled: false },
      media: [],
      approvedRevision: null,
      companyPublication: { status: "pending", urn: null, url: null },
      personalPublication: { status: "pending", urn: null, url: null },
      pendingMessage: null,
      error: null,
      updatedAt: "2026-11-04T00:00:00Z",
    };
    const withMedia = {
      ...draft,
      media: [
        {
          id: "image",
          name: "capture.png",
          mimeType: "image/png" as const,
          dataUrl: "data:image/png;base64,cHJpdmF0ZS1pbWFnZS1ieXRlcw==",
          source: "Fixture only",
          alt: "Product capture",
        },
      ],
    };
    const registration = toolkitRegistration(MarketingToolkit, layer).pipe(
      Layer.provideMerge(layerInProcessMcpServer),
      Layer.provide(NodeCrypto.layer),
      Layer.provide(Testkit.liveThreadsLayer),
      Layer.provide(
        Layer.mock(Marketing.MarketingService)({
          context: () =>
            Effect.succeed({
              draft: withMedia,
              publishingConfigured: false,
              publishingReason: "Not connected",
            }),
          agent: () => Effect.succeed(withMedia),
        }),
      ),
    );
    yield* Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      for (const [name, args] of [
        ["marketing_studio", {}],
        [
          "marketing_update",
          { command: { type: "report_blocker", expectedRevision: 1, message: "Fixture" } },
        ],
      ] as const) {
        const result = yield* server.callTool({ name, arguments: args }).pipe(
          Effect.provideService(Invocation.McpInvocationContext, {
            environmentId: EnvironmentId.make("test"),
            requestNamespace: "test",
            thread: {
              threadId: ThreadId.make("thread"),
              providerSessionId: "session",
              providerInstanceId: ProviderInstanceId.make("codex"),
            },
            client: undefined,
            issuedAt: 0,
            capabilities: new Set(["orchestration"] as const),
          }),
          Effect.provideService(
            McpSchema.McpServerClient,
            McpSchema.McpServerClient.of({
              clientId: 1,
              protocolVersion: "2025-06-18",
              clientCapabilities: {},
              clientInfo: { name: "test", version: "1" },
              initializePayload: {
                protocolVersion: "2025-06-18",
                capabilities: {},
                clientInfo: { name: "test", version: "1" },
              },
              getClient: Effect.die("unused"),
            }),
          ),
        );
        expect(result.isError).not.toBe(true);
        expect(JSON.stringify(result)).toContain("Product capture");
        expect(JSON.stringify(result)).not.toContain("dataUrl");
        expect(JSON.stringify(result)).not.toContain("cHJpdmF0ZS1pbWFnZS1ieXRlcw==");
      }
    }).pipe(Effect.provide(registration));
  }).pipe(Effect.scoped),
);
