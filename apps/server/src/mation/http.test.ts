import { NodeHttpPlatform } from "@effect/platform-node";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, expect } from "@effect/vitest";
import {
  AuthSessionId,
  CommandId,
  EnvironmentId,
  RunId,
  EnvironmentHttpApi,
  ExecutionHttpApi,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { HttpRouter } from "effect/http";
import * as Etag from "effect/http/Etag";
import * as Auth from "../auth/EnvironmentAuth.ts";
import * as AuthHttp from "../auth/http.ts";
import * as Requests from "../orchestration-v2/ExecutionRequestService.ts";
import * as RequestsHttp from "../orchestration-v2/executionRequestsHttp.ts";
import * as Execution from "./AutomationExecutionService.ts";
import { layer } from "./http.ts";

class MationTestApi extends HttpApi.make("environment").add(EnvironmentHttpApi.groups.mation) {}
it("Mation frontend requests and generic executions enforce the destination environment scopes", async () => {
  const forwarded: string[] = [];
  const routes = HttpApiBuilder.layer(MationTestApi).pipe(
    Layer.provide(layer),
    Layer.merge(HttpApiBuilder.layer(ExecutionHttpApi).pipe(Layer.provide(RequestsHttp.layer))),
    Layer.provide(
      Layer.mock(Requests.ExecutionRequestService)({
        get: () =>
          Effect.fail(
            new Requests.ExecutionNotFoundError({ commandId: CommandId.make("fixture") }),
          ),
        start: (commandId, input) =>
          Effect.sync(() => {
            forwarded.push(`PUT ${commandId} ${input.messageId}`);
            return {
              ref: {
                environmentId: EnvironmentId.make("env"),
                threadId: input.threadId,
                runId: RunId.make("run"),
              },
              status: "queued",
              startedAt: null,
              completedAt: null,
              worktreePath: null,
              branch: null,
            } as const;
          }),
      }),
    ),
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
      Layer.mock(Execution.AutomationExecutionService)({
        frontend: Effect.succeed({ html: "<main>Mation</main>" }),
        frontendRequest: (input) =>
          Effect.sync(() => {
            forwarded.push(`${input.method} ${input.path}`);
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
      new Request("http://t3.test/api/mation/request", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: `{"path":"automations","method":"${method}"}`,
      }),
    );
  try {
    expect((await request("GET", "reader")).status).toBe(200);
    expect((await request("POST", "reader")).status).toBe(403);
    expect((await request("POST", "operator")).status).toBe(200);
    expect((await request("GET", "invalid")).status).toBe(401);
    expect(forwarded).toEqual(["GET automations", "POST automations"]);
    const executionRequest = (token: string) =>
      handler(
        new Request("http://t3.test/api/executions/caller%3Asubmission", {
          method: "PUT",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({
            threadId: "thread",
            messageId: "message",
            title: "Request",
            prompt: "Read only",
            target: {
              projectId: "project",
              threadId: null,
              workspaceStrategy: { type: "root" },
              modelSelection: { instanceId: "codex", model: "test" },
              runtimeMode: "auto",
              interactionMode: "default",
            },
          }),
        }),
      );
    expect((await executionRequest("reader")).status).toBe(403);
    expect((await executionRequest("operator")).status).toBe(200);
    expect((await executionRequest("invalid")).status).toBe(401);
    expect(forwarded.at(-1)).toBe("PUT caller:submission message");
    const lookup =
      "http://t3.test/api/executions/caller%3Amissing?projectId=project&threadId=thread&messageId=message";
    expect(
      (await handler(new Request(lookup, { headers: { authorization: "Bearer reader" } }))).status,
    ).toBe(404);
    expect((await handler(new Request(lookup))).status).toBe(401);
  } finally {
    await dispose();
  }
});
