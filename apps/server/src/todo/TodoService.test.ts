import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, expect } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { FetchHttpClient } from "effect/http";
import * as Todo from "./TodoService.ts";

it.effect(
  "Todo connects directly to its own service and keeps its credential out of the returned page",
  () =>
    Effect.gen(function* () {
      const requests: Request[] = [];
      const fetcher: typeof globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        return new Response('{"status":200,"body":"{\\"html\\":\\"<main>Todo</main>\\"}"}', {
          status: 200,
        });
      };
      const result = yield* Effect.gen(function* () {
        return yield* (yield* Todo.TodoService).page;
      }).pipe(
        Effect.provide(
          Todo.layer.pipe(Layer.provide(FetchHttpClient.layer), Layer.provide(NodeServices.layer)),
        ),
        Effect.provideService(FetchHttpClient.Fetch, fetcher),
        Effect.provideService(HostProcess.Environment, {
          TODO_URL: "http://todo.test",
          TODO_SERVICE_TOKEN: "private-fixture-token",
        }),
      );
      expect(result).toEqual({ html: "<main>Todo</main>" });
      expect(requests).toHaveLength(1);
      expect(requests[0]!.url).toBe("http://todo.test/api/frontend/request");
      expect(requests[0]!.headers.get("authorization")).toBe("Bearer private-fixture-token");
      expect(yield* Effect.promise(() => requests[0]!.text())).toBe(
        '{"path":"todos/page","method":"GET"}',
      );
    }),
);

it.effect("a missing Todo connection fails without falling back to Mation", () =>
  Effect.gen(function* () {
    const result = yield* Effect.gen(function* () {
      return yield* (yield* Todo.TodoService).page;
    }).pipe(
      Effect.provide(
        Todo.layer.pipe(Layer.provide(FetchHttpClient.layer), Layer.provide(NodeServices.layer)),
      ),
      Effect.provideService(HostProcess.Environment, {
        MATION_URL: "http://mation.test",
        MATION_SERVICE_TOKEN: "other-token",
      }),
      Effect.result,
    );
    expect(result._tag).toBe("Failure");
  }),
);
