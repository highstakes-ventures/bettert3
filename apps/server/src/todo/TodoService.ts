import { TodoFrontendPage, TodoFrontendResponse, TodoFrontendRequest } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import * as HostProcess from "@t3tools/shared/HostProcess";

export class TodoOperationError extends Schema.TaggedError<TodoOperationError>()(
  "TodoOperationError",
  {
    operation: Schema.Literals(["connect", "request", "decode"]),
    cause: Schema.Defect(),
  },
) {
  override get message() {
    return "Todo could not complete this request. Check this environment's Todo connection.";
  }
}

export class TodoService extends Context.Service<
  TodoService,
  {
    readonly page: Effect.Effect<typeof TodoFrontendPage.Type, TodoOperationError>;
    readonly request: (
      input: TodoFrontendRequest,
    ) => Effect.Effect<TodoFrontendResponse, TodoOperationError>;
  }
>()("t3/todo/TodoService") {}

const encodeRequest = Schema.encodeEffect(Schema.fromJsonString(TodoFrontendRequest));
const decodeResponse = Schema.decodeUnknownEffect(Schema.fromJsonString(TodoFrontendResponse));
const decodePage = Schema.decodeUnknownEffect(Schema.fromJsonString(TodoFrontendPage));

const make = Effect.gen(function* () {
  const http = yield* HttpClient.HttpClient;
  const variables = yield* HostProcess.Environment;
  const fs = yield* FileSystem.FileSystem;
  const endpoint = variables.TODO_URL;
  const token = variables.TODO_SERVICE_TOKEN_FILE
    ? yield* fs.readFileString(variables.TODO_SERVICE_TOKEN_FILE).pipe(
        Effect.map((value) => value.trim()),
        Effect.orElseSucceed(() => undefined),
      )
    : variables.TODO_SERVICE_TOKEN;
  const request = Effect.fn("todo.frontendRequest")(function* (input: TodoFrontendRequest) {
    if (!endpoint || !token)
      return yield* new TodoOperationError({
        operation: "connect",
        cause: new Error("Todo is not connected."),
      });
    const url = yield* Effect.try({
      try: () => {
        const url = new URL("/api/frontend/request", endpoint);
        if (url.username || url.password || !["http:", "https:"].includes(url.protocol))
          throw new Error("Invalid Todo URL.");
        return url;
      },
      catch: (cause) => new TodoOperationError({ operation: "connect", cause }),
    });
    const body = yield* encodeRequest(input).pipe(
      Effect.mapError((cause) => new TodoOperationError({ operation: "request", cause })),
    );
    const response = yield* http
      .execute(
        HttpClientRequest.post(url.href).pipe(
          HttpClientRequest.setHeader("authorization", `Bearer ${token}`),
          HttpClientRequest.bodyText(body, "application/json"),
        ),
      )
      .pipe(
        Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
        Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
        Effect.timeout("15 seconds"),
        Effect.mapError((cause) => new TodoOperationError({ operation: "request", cause })),
      );
    if (Number(response.headers["content-length"] ?? 0) > 8 * 1024 * 1024)
      return yield* new TodoOperationError({
        operation: "decode",
        cause: new Error("Todo response is too large."),
      });
    const buffer = yield* response.arrayBuffer.pipe(
      Effect.mapError((cause) => new TodoOperationError({ operation: "decode", cause })),
    );
    if (buffer.byteLength > 8 * 1024 * 1024)
      return yield* new TodoOperationError({
        operation: "decode",
        cause: new Error("Todo response is too large."),
      });
    const responseBody = new TextDecoder().decode(buffer);
    if (response.status !== 200) return { status: response.status, body: responseBody };
    return yield* decodeResponse(responseBody).pipe(
      Effect.mapError((cause) => new TodoOperationError({ operation: "decode", cause })),
    );
  });
  const page = request({ path: "todos/page", method: "GET" }).pipe(
    Effect.flatMap((result) =>
      result.status === 200
        ? decodePage(result.body).pipe(
            Effect.mapError((cause) => new TodoOperationError({ operation: "decode", cause })),
          )
        : Effect.fail(
            new TodoOperationError({
              operation: "request",
              cause: new Error("Todo did not return its page."),
            }),
          ),
    ),
  );
  return TodoService.of({ page, request });
});

export const layer = Layer.effect(TodoService, make);
