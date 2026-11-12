import { EnvironmentId, ThreadId, RunId, ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import * as Mation from "../mation/AutomationExecutionService.ts";
import * as Environment from "../environment/ServerEnvironment.ts";
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
import * as Pai from "./PaiService.ts";
import { layer } from "./http.ts";
import { PaiPublishEmailInput, MationPublishEmailInput } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const decodePublication = Schema.decodeEffect(PaiPublishEmailInput);
const decodeLegacyPublication = Schema.decodeEffect(MationPublishEmailInput);

it.effect(
  "calendar data crosses both publication contracts with provider links and authenticated run identity intact",
  () =>
    Effect.gen(function* () {
      const calendar = {
        date: "2026-11-03",
        timeZone: "Europe/Amsterdam",
        readAt: "2026-11-03T07:00:00Z",
        sources: [{ account: "joseph@recuut.com", calendarId: "primary", status: "read" as const }],
        events: [
          {
            account: "joseph@recuut.com",
            calendarId: "primary",
            eventId: "instance-id",
            title: "Productoverleg",
            start: "2026-11-03T08:00:00Z",
            end: "2026-11-03T09:00:00Z",
            htmlLink: "https://www.google.com/calendar/event?eid=provider-instance",
          },
        ],
      };
      const input = yield* decodePublication({ items: [], calendar });
      const legacy = yield* decodeLegacyPublication({
        requestId: "00000000-0000-4000-8000-000000000001",
        ...input,
      });
      expect(legacy.calendar).toEqual(calendar);
      const caller = {
        id: ThreadId.make("morning"),
        activeRunId: RunId.make("current-run"),
        projectId: ProjectId.make("project"),
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
        runtimeMode: "auto" as const,
        interactionMode: "default" as const,
      };
      let published: Record<string, unknown> | undefined;
      const dependencies = Layer.mergeAll(
        Layer.mock(Mation.AutomationExecutionService)({
          proxy: (_path, _method, body) =>
            Effect.sync(() => {
              published = JSON.parse(new TextDecoder().decode(body));
              return {
                status: 200,
                body: new TextEncoder().encode(
                  JSON.stringify({ published: 0, paiWidget: { reportId: "a".repeat(64) } }),
                ),
                contentType: "application/json",
              };
            }),
        }),
        Layer.mock(Environment.ServerEnvironmentIdentity)({
          getEnvironmentId: Effect.succeed(EnvironmentId.make("environment")),
        }),
      );
      yield* Effect.gen(function* () {
        const service = yield* Pai.PaiService;
        const untrusted = {
          ...input,
          source: { environmentId: "forged-environment" },
          target: { projectId: "forged-project" },
        };
        yield* service.publish(untrusted, caller);
      }).pipe(Effect.provide(Pai.layer.pipe(Layer.provide(dependencies))));
      expect(published?.calendar).toEqual(calendar);
      expect(published?.source).toEqual({
        environmentId: "environment",
        threadId: "morning",
        runId: "current-run",
      });
      expect(published?.target).toMatchObject({ projectId: "project" });
    }),
);

class PaiTestApi extends HttpApi.make(BetterT3HttpApi.identifier).add(BetterT3HttpApi.groups.pai) {}

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
          proxy: (path, method, body) =>
            Effect.sync(() => {
              publications++;
              expect(path).toBe("/api/email/actions/00000000-0000-4000-8000-000000000001/complete");
              expect(method).toBe("POST");
              expect(JSON.parse(new TextDecoder().decode(body))).toEqual({
                source: ref,
                message: "Draft prepared",
              });
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
        for (const deniedCaller of [
          { ...caller, id: ThreadId.make("other-chat") },
          { ...caller, projectId: ProjectId.make("other-project") },
          { ...caller, activeRunId: null },
        ]) {
          const denied = yield* service
            .complete(
              { actionId: "00000000-0000-4000-8000-000000000001", message: "Untrusted result" },
              deniedCaller,
            )
            .pipe(Effect.flip);
          expect(denied.message).toContain(
            deniedCaller.activeRunId === null ? "active T3 run" : "original T3 source",
          );
        }
      }).pipe(Effect.provide(Pai.layer.pipe(Layer.provide(dependencies))));
      expect(publications).toBe(1);
    }),
);
