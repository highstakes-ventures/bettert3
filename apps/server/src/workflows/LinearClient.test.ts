import { expect, it } from "@effect/vitest";
import type { WorkflowTicketDraft } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as Linear from "./LinearClient.ts";

const page = (nodes: unknown[], more = false, cursor: string | null = null) => ({
  nodes,
  pageInfo: { hasNextPage: more, endCursor: cursor },
});
const reference = (id: string) => ({
  id,
  identifier: `REC-${id}`,
  title: id,
  url: `https://linear.app/issue/${id}`,
  state: { id: "todo", type: "unstarted" },
});
const issue = (id: string) => ({
  ...reference(id),
  updatedAt: "2026-10-21T00:00:00Z",
  description: null,
  priority: 3,
  estimate: null,
  dueDate: null,
  team: { id: "team", name: "Team" },
  project: null,
  labels: page([]),
  relations: page([]),
  inverseRelations: page([]),
  comments: page([]),
  attachments: page([]),
});
const draft: WorkflowTicketDraft = {
  title: "Concrete title",
  description: "Concrete scope",
  targetProjectId: null,
  priority: 3,
  labelIds: [],
  blockedBy: ["new-blocker"],
  dependencyEvidence: [],
};
const fixture = (
  respond: (
    query: string,
    variables: Record<string, unknown>,
  ) => { data?: unknown; errors?: unknown[]; status?: number },
) => {
  const calls: Array<{ query: string; variables: Record<string, unknown> }> = [];
  const stored: Uint8Array[] = [];
  const layer = Linear.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ServerSecretStore.ServerSecretStore)({
          get: () => Effect.succeed(Option.some(new TextEncoder().encode("secret-test-key"))),
          set: (_name, value) =>
            Effect.sync(() => {
              stored.push(value);
            }),
        }),
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) =>
            Effect.sync(() => {
              expect(request.url).toBe("https://api.linear.app/graphql");
              expect(request.headers.authorization).toBe("secret-test-key");
              expect(request.body._tag).toBe("Uint8Array");
              const body =
                request.body._tag === "Uint8Array"
                  ? JSON.parse(new TextDecoder().decode(request.body.body))
                  : {};
              calls.push(body);
              const response = respond(body.query, body.variables);
              return HttpClientResponse.fromWeb(
                request,
                Response.json(
                  { data: response.data, errors: response.errors },
                  { status: response.status ?? 200 },
                ),
              );
            }),
          ),
        ),
      ),
    ),
  );
  return { layer, calls, stored };
};

it.effect("loads native incoming blockers and all paginated ticket details", () => {
  const f = fixture((query, variables) => {
    if (query.includes("$after"))
      return {
        data: {
          issue: {
            comments: page([
              { id: "second", body: "More evidence", createdAt: "2026-10-21", user: null },
            ]),
          },
        },
      };
    expect(variables.id).toBe("ticket");
    return {
      data: {
        issue: {
          ...issue("ticket"),
          comments: page(
            [
              {
                id: "first",
                body: "Evidence",
                createdAt: "2026-10-20",
                user: { id: "user", name: "Joseph" },
              },
            ],
            true,
            "next-page",
          ),
          inverseRelations: page([
            { id: "relation", type: "blocks", issue: reference("prerequisite") },
          ]),
          relations: page([{ id: "out", type: "blocks", relatedIssue: reference("dependent") }]),
        },
      },
    };
  });
  return Effect.gen(function* () {
    const client = yield* Linear.LinearClient;
    const ticket = yield* client.read("ticket");
    expect(ticket.blockedBy.map((entry) => entry.id)).toEqual(["prerequisite"]);
    expect(ticket.blocks.map((entry) => entry.id)).toEqual(["dependent"]);
    expect(ticket.comments.map((entry) => entry.id)).toEqual(["first", "second"]);
    expect(ticket.description).toBe("");
    expect(f.calls[1]?.variables.after).toBe("next-page");
  }).pipe(Effect.provide(f.layer));
});

it.effect("recovers an ambiguous issue create by the persisted UUID without duplicating it", () => {
  const f = fixture((query) => {
    if (query.includes("issues(filter"))
      return { data: { issues: { nodes: [{ id: "stable-id", team: { id: "team" } }] } } };
    if (query.includes("mutation"))
      return { data: { issueUpdate: { success: true }, issueRelationCreate: { success: true } } };
    return {
      data: {
        issue: {
          ...issue("stable-id"),
          title: draft.title,
          description: draft.description,
          inverseRelations: page([
            { id: "existing-blocker", type: "blocks", issue: reference("new-blocker") },
          ]),
        },
      },
    };
  });
  return Effect.gen(function* () {
    yield* (yield* Linear.LinearClient).save({
      id: "stable-id",
      teamId: "team",
      draft,
      create: true,
    });
    expect(f.calls.some((call) => call.query.includes("issueCreate("))).toBe(false);
    expect(f.calls.some((call) => call.query.includes("mutation"))).toBe(false);
  }).pipe(Effect.provide(f.layer));
});

it.effect("does not overwrite edits made after an ambiguous create", () => {
  const f = fixture((query) => {
    if (query.includes("issues(filter"))
      return { data: { issues: { nodes: [{ id: "stable-id", team: { id: "team" } }] } } };
    if (query.includes("mutation"))
      return {
        data: {
          issueUpdate: { success: true },
          issueRelationCreate: { success: true },
          issueRelationDelete: { success: true },
        },
      };
    return {
      data: {
        issue: {
          ...issue("stable-id"),
          description: "Human scope change",
          inverseRelations: page([
            { id: "human-blocker", type: "blocks", issue: reference("human-prerequisite") },
          ]),
        },
      },
    };
  });
  return Effect.gen(function* () {
    yield* (yield* Linear.LinearClient)
      .save({ id: "stable-id", teamId: "team", draft, create: true })
      .pipe(Effect.flip);
    expect(f.calls.some((call) => call.query.includes("mutation"))).toBe(false);
  }).pipe(Effect.provide(f.layer));
});

it.effect(
  "refuses a replay against a different native revision without mutating fields or blockers",
  () => {
    const f = fixture((query) =>
      query.includes("mutation")
        ? { data: { issueUpdate: { success: true }, issueRelationCreate: { success: true } } }
        : { data: { issue: { ...issue("ticket"), updatedAt: "newer-native-revision" } } },
    );
    return Effect.gen(function* () {
      yield* (yield* Linear.LinearClient)
        .save({
          id: "ticket",
          teamId: "team",
          draft,
          create: false,
          expectedUpdatedAt: "original-revision",
        })
        .pipe(Effect.flip);
      expect(f.calls.some((call) => call.query.includes("mutation"))).toBe(false);
    }).pipe(Effect.provide(f.layer));
  },
);

it.effect("changes only native blocker relations and preserves unrelated links", () => {
  const f = fixture((query) =>
    query.includes("mutation")
      ? {
          data: {
            issueUpdate: { success: true },
            issueRelationCreate: { success: true },
            issueRelationDelete: { success: true },
          },
        }
      : {
          data: {
            issue: {
              ...issue("ticket"),
              inverseRelations: page([
                { id: "old-block", type: "blocks", issue: reference("old") },
                { id: "related", type: "related", issue: reference("neighbor") },
              ]),
            },
          },
        },
  );
  return Effect.gen(function* () {
    yield* (yield* Linear.LinearClient).save({
      id: "ticket",
      teamId: "team",
      draft,
      create: false,
      expectedUpdatedAt: "2026-10-21T00:00:00Z",
    });
    const deletes = f.calls.filter((call) => call.query.includes("issueRelationDelete("));
    expect(deletes.map((call) => call.variables.id)).toEqual(["old-block"]);
  }).pipe(Effect.provide(f.layer));
});

it.effect("refuses to update a ticket moved to another team", () => {
  const f = fixture(() => ({
    data: { issue: { ...issue("ticket"), team: { id: "other", name: "Other" } } },
  }));
  return Effect.gen(function* () {
    yield* (yield* Linear.LinearClient)
      .save({ id: "ticket", teamId: "team", draft, create: false })
      .pipe(Effect.flip);
    expect(f.calls.some((call) => call.query.includes("mutation"))).toBe(false);
  }).pipe(Effect.provide(f.layer));
});

it.effect(
  "keeps credentials out of connection responses and refuses invalid credentials before storing",
  () => {
    const f = fixture(() => ({ errors: [{ message: "secret-test-key rejected" }] }));
    return Effect.gen(function* () {
      const error = yield* (yield* Linear.LinearClient)
        .connect("secret-test-key")
        .pipe(Effect.flip);
      expect(error.message).not.toContain("secret-test-key");
      expect(f.stored).toEqual([]);
    }).pipe(Effect.provide(f.layer));
  },
);
