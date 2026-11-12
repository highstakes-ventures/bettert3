import { NodeHttpPlatform } from "@effect/platform-node";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, expect } from "@effect/vitest";
import { AuthSessionId, BetterT3HttpApi } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { HttpRouter } from "effect/http";
import * as Etag from "effect/http/Etag";
import * as Auth from "../auth/EnvironmentAuth.ts";
import * as AuthHttp from "../auth/http.ts";
import * as Execution from "./TodoService.ts";
import { layer } from "./http.ts";

class TodoTestApi extends HttpApi.make(BetterT3HttpApi.identifier).add(
  BetterT3HttpApi.groups.todo,
) {}
it("Todo reads and writes enforce the destination environment scopes", async () => {
  const forwarded: string[] = [];
  const routes = HttpApiBuilder.layer(TodoTestApi).pipe(
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
      Layer.mock(Execution.TodoService)({
        page: Effect.succeed({ html: "<main>Mation</main>" }),
        request: (input) =>
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
      new Request("http://t3.test/api/todo/request", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: `{"path":"todos","method":"${method}"}`,
      }),
    );
  try {
    expect((await request("GET", "reader")).status).toBe(200);
    expect((await request("POST", "reader")).status).toBe(403);
    expect((await request("POST", "operator")).status).toBe(200);
    expect((await request("GET", "invalid")).status).toBe(401);
    expect(forwarded).toEqual(["GET todos", "POST todos"]);
  } finally {
    await dispose();
  }
});
