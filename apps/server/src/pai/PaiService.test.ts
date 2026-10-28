import { EnvironmentId, ThreadId, RunId, ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import * as Mation from "../mation/AutomationExecutionService.ts";
import * as Environment from "../environment/ServerEnvironment.ts";
import { NodeHttpPlatform } from "@effect/platform-node";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, expect } from "@effect/vitest";
import { AuthSessionId, EnvironmentHttpApi } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { HttpRouter } from "effect/http";
import * as Etag from "effect/http/Etag";
import * as Auth from "../auth/EnvironmentAuth.ts";
import * as AuthHttp from "../auth/http.ts";
import * as Pai from "./PaiService.ts";
import { layer } from "./http.ts";

class PaiTestApi extends HttpApi.make("environment").add(EnvironmentHttpApi.groups.pai) {}

it("PAI reads require read scope, while every action requires operate scope in the destination environment", async () => {
  const forwarded: string[] = [];
  const routes = HttpApiBuilder.layer(PaiTestApi).pipe(
    Layer.provide(layer),
    Layer.provide(AuthHttp.layerAuthenticatedAuth),
    Layer.provide(
      Layer.mock(Auth.EnvironmentAuth)({
        authenticateHttpRequest: (request) =>
          request.headers.authorization === "Bearer reader"
            ? Effect.succeed({
                sessionId: AuthSessionId.make("reader"),
                subject: "cli-issued-session",
                method: "bearer-access-token",
                scopes: ["orchestration:read"],
              })
            : request.headers.authorization === "Bearer operator"
              ? Effect.succeed({
                  sessionId: AuthSessionId.make("operator"),
                  subject: "cli-issued-session",
                  method: "bearer-access-token",
                  scopes: ["orchestration:read", "orchestration:operate"],
                })
              : Effect.fail(new Auth.ServerAuthInvalidCredentialError({ diagnostic: "test" })),
      }),
    ),
    Layer.provide(
      Layer.mock(Pai.PaiService)({
        page: Effect.succeed({ html: "<main>PAI widget</main>" }),
        request: (input) =>
          Effect.sync(() => {
            forwarded.push(input.method);
            return { status: 200, body: "{}" };
          }),
      }),
    ),
  );
  const { handler, dispose } = HttpRouter.toWebHandler(
    routes.pipe(
      Layer.provide(NodeHttpPlatform.layer),
      Layer.provide(Etag.layerWeak),
      Layer.provide(NodeServices.layer),
    ),
    { disableLogger: true },
  );
  const request = (method: string, token: string) =>
    handler(
      new Request("http://t3.test/api/pai/request", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          reportId: "a".repeat(64),
          method,
          ...(method === "POST" ? { body: "{}" } : {}),
        }),
      }),
    );
  try {
    expect((await request("GET", "reader")).status).toBe(200);
    expect((await request("POST", "reader")).status).toBe(403);
    expect((await request("POST", "operator")).status).toBe(200);
    expect((await request("GET", "invalid")).status).toBe(401);
    expect(forwarded).toEqual(["GET", "POST"]);
  } finally {
    await dispose();
  }
});

it.effect(
  "a reply in the dedicated action chat can confirm the original execution, while another chat is rejected before publication",
  () =>
    Effect.gen(function* () {
      const ref = {
        environmentId: EnvironmentId.make("env"),
        threadId: ThreadId.make("action-chat"),
        runId: RunId.make("original-run"),
      };
      const caller = {
        id: ref.threadId,
        activeRunId: RunId.make("reply-with-context"),
        projectId: ProjectId.make("project"),
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
        runtimeMode: "auto" as const,
        interactionMode: "default" as const,
      };
      let publications = 0;
      const dependencies = Layer.mergeAll(
        Layer.mock(Mation.AutomationExecutionService)({
          get: (_id, query) =>
            query.threadId === ref.threadId && query.projectId === caller.projectId
              ? Effect.succeed({
                  ref,
                  status: "completed",
                  startedAt: null,
                  completedAt: null,
                  worktreePath: null,
                  branch: null,
                })
              : Effect.fail(new Mation.MationConflictError({ requestId: "wrong-chat" })),
          proxy: (_path, _method, body) =>
            Effect.sync(() => {
              publications++;
              expect(JSON.parse(new TextDecoder().decode(body)).source).toEqual(ref);
              return {
                status: 200,
                body: new TextEncoder().encode(JSON.stringify({ completed: true })),
                contentType: "application/json",
              };
            }),
        }),
        Layer.mock(Environment.ServerEnvironmentIdentity)({
          getEnvironmentId: Effect.succeed(ref.environmentId),
        }),
      );
      yield* Effect.gen(function* () {
        const service = yield* Pai.PaiService;
        yield* service.complete(
          { actionId: "00000000-0000-4000-8000-000000000001", message: "Draft prepared" },
          caller,
        );
        const denied = yield* service
          .complete(
            { actionId: "00000000-0000-4000-8000-000000000001", message: "Wrong chat" },
            { ...caller, id: ThreadId.make("other-chat") },
          )
          .pipe(Effect.exit);
        expect(denied._tag).toBe("Failure");
      }).pipe(Effect.provide(Pai.layer.pipe(Layer.provide(dependencies))));
      expect(publications).toBe(1);
    }),
);
