import { expect, it } from "@effect/vitest";
import {
  WorkflowSearchResult,
  WorkflowTicket,
  WORKFLOW_CANDIDATE_CONTEXT_CODE_POINTS,
  type WorkflowTicketDraft,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientResponse } from "effect/http";
import { TestClock } from "effect/testing";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as Linear from "./LinearClient.ts";

const isSearchResult = Schema.is(WorkflowSearchResult);
const isCompleteTicket = Schema.is(WorkflowTicket);

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
type LinearResponse = {
  data?: unknown;
  errors?: unknown[];
  status?: number;
  headers?: Record<string, string>;
};
const fixture = (
  respond: (
    query: string,
    variables: Record<string, unknown>,
    credential: string,
  ) => LinearResponse | Effect.Effect<LinearResponse>,
) => {
  const calls: Array<{ query: string; variables: Record<string, unknown> }> = [];
  const stored: Uint8Array[] = [];
  let credential = Option.some(new TextEncoder().encode("secret-test-key"));
  const layer = Linear.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ServerSecretStore.ServerSecretStore)({
          get: () => Effect.sync(() => credential),
          remove: () =>
            Effect.sync(() => {
              credential = Option.none();
            }),
          set: (_name, value) =>
            Effect.sync(() => {
              stored.push(value);
              credential = Option.some(new Uint8Array(value));
            }),
        }),
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) =>
            Effect.gen(function* () {
              expect(request.url).toBe("https://api.linear.app/graphql");
              expect(request.headers.authorization).toMatch(/^secret-test-key(?:-other)?$/);
              expect(request.body._tag).toBe("Uint8Array");
              const body =
                request.body._tag === "Uint8Array"
                  ? JSON.parse(new TextDecoder().decode(request.body.body))
                  : {};
              calls.push(body);
              const reply = respond(body.query, body.variables, request.headers.authorization!);
              const response = Effect.isEffect(reply) ? yield* reply : reply;
              return HttpClientResponse.fromWeb(
                request,
                Response.json(
                  { data: response.data, errors: response.errors },
                  { status: response.status ?? 200, headers: response.headers ?? {} },
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

it.effect.each([0, 17, 30])(
  "searches %i candidates in one bounded, team-scoped request",
  (count) => {
    const f = fixture((query, variables) => {
      expect(query).toContain("issues(first:30,filter:$filter)");
      expect(query).not.toMatch(/issue\(id:|comments|attachments|labels|relations|after:/);
      expect(variables.filter).toEqual({
        team: { id: { eq: "team" } },
        or: [
          { title: { containsIgnoreCase: "PeRfOrMaNcE" } },
          { description: { containsIgnoreCase: "PeRfOrMaNcE" } },
        ],
      });
      return {
        data: {
          issues: {
            nodes: Array.from({ length: count }, (_, index) => ({
              ...issue(String(index)),
              description: index === 0 ? null : "Performance context",
            })),
            pageInfo: { hasNextPage: count === 30 },
          },
        },
      };
    });
    return Effect.gen(function* () {
      const result = yield* (yield* Linear.LinearClient).search("team", "PeRfOrMaNcE");
      expect(result.candidates).toHaveLength(count);
      expect(result.hasMore).toBe(count === 30);
      expect(f.calls).toHaveLength(1);
      expect(isSearchResult(result)).toBe(true);
      if (count > 0) {
        expect(result.candidates[0]).toEqual({
          id: "0",
          identifier: "REC-0",
          title: "0",
          url: "https://linear.app/issue/0",
          teamId: "team",
          stateId: "todo",
          stateType: "unstarted",
          descriptionExcerpt: "",
          descriptionTruncated: false,
        });
        expect(isCompleteTicket(result.candidates[0])).toBe(false);
      }
    }).pipe(Effect.provide(f.layer));
  },
);

it.effect(
  "bounds Unicode context around a literal description match and marks incomplete evidence",
  () => {
    const description = "😀".repeat(2_000) + "PeRfOrMaNcE [a+b]" + "界".repeat(2_000);
    const f = fixture(() => ({
      data: {
        issues: {
          nodes: [
            { ...issue("long"), description },
            { ...issue("exact"), description: "😀".repeat(WORKFLOW_CANDIDATE_CONTEXT_CODE_POINTS) },
          ],
          pageInfo: { hasNextPage: false },
        },
      },
    }));
    return Effect.gen(function* () {
      const result = yield* (yield* Linear.LinearClient).search("team", "performance [a+b]");
      const long = result.candidates[0]!;
      expect(Array.from(long.descriptionExcerpt)).toHaveLength(
        WORKFLOW_CANDIDATE_CONTEXT_CODE_POINTS,
      );
      expect(long.descriptionExcerpt).toContain("PeRfOrMaNcE [a+b]");
      expect(long.descriptionExcerpt.isWellFormed()).toBe(true);
      expect(long.descriptionTruncated).toBe(true);
      expect(result.candidates[1]?.descriptionTruncated).toBe(false);
      expect(
        isSearchResult({
          ...result,
          candidates: [{ ...long, descriptionExcerpt: "😀".repeat(1_201) }],
        }),
      ).toBe(false);
      expect(f.calls).toHaveLength(1);
    }).pipe(Effect.provide(f.layer));
  },
);

it.effect(
  "keeps search requests and compact UTF-8 result bytes independent of comment volume",
  () =>
    Effect.gen(function* () {
      const results: Array<{ requests: number; bytes: number }> = [];
      for (const commentCount of [0, 250]) {
        const f = fixture((query) => {
          expect(query).not.toContain("comments");
          return {
            data: {
              issues: {
                nodes: Array.from({ length: 30 }, (_, index) => ({
                  ...issue(String(index)),
                  description: "Useful context 😀",
                  comments: page(
                    Array.from({ length: commentCount }, (_, i) => ({
                      id: String(i),
                      body: "Evidence".repeat(1_000),
                      createdAt: "2026-10-23",
                      user: null,
                    })),
                    commentCount > 100,
                    "more-comments",
                  ),
                })),
                pageInfo: { hasNextPage: false },
              },
            },
          };
        });
        const result = yield* Linear.LinearClient.pipe(
          Effect.flatMap((client) => client.search("team", "context")),
          Effect.provide(f.layer),
        );
        results.push({
          requests: f.calls.length,
          bytes: new TextEncoder().encode(JSON.stringify(result)).byteLength,
        });
      }
      expect(results[0]?.requests).toBe(1);
      expect(results[1]).toEqual(results[0]);
    }),
);

it.effect("reads selected evidence afresh and drains every collection without mutations", () => {
  const description = "Full description 😀".repeat(500);
  const collections = {
    labels: [{ id: "label", name: "Label" }],
    relations: [{ id: "out", type: "blocks", relatedIssue: reference("dependent") }],
    inverseRelations: [{ id: "in", type: "blocks", issue: reference("prerequisite") }],
    comments: [
      { id: "comment", body: "Full comment".repeat(500), createdAt: "2026-10-23", user: null },
    ],
    attachments: [{ title: "Proof", url: "https://example.com/proof" }],
  };
  let revision = "before-search";
  const f = fixture((query, variables) => {
    if (query.includes("issues(first:"))
      return {
        data: {
          issues: {
            nodes: [{ ...issue("selected"), description }],
            pageInfo: { hasNextPage: false },
          },
        },
      };
    expect(variables.id).toBe("selected");
    expect(query).not.toContain("mutation");
    if (query.includes("$after")) {
      const name = Object.keys(collections).find((key) => query.includes(`${key}(first:`))!;
      expect(variables.after).toBe(`${name}-next`);
      return { data: { issue: { [name]: page(collections[name as keyof typeof collections]) } } };
    }
    return {
      data: {
        issue: {
          ...issue("selected"),
          description,
          updatedAt: revision,
          ...Object.fromEntries(
            Object.keys(collections).map((name) => [name, page([], true, `${name}-next`)]),
          ),
        },
      },
    };
  });
  return Effect.gen(function* () {
    const client = yield* Linear.LinearClient;
    yield* client.search("team", "description");
    revision = "fresh-selected-revision";
    const selected = yield* client.read("selected");
    expect(selected.updatedAt).toBe(revision);
    expect(selected.description).toBe(description);
    expect(selected.labels).toEqual(collections.labels);
    expect(selected.comments[0]?.body).toBe(collections.comments[0]!.body);
    expect(selected.resources).toEqual(collections.attachments);
    expect(selected.blockedBy.map((value) => value.id)).toEqual(["prerequisite"]);
    expect(selected.blocks.map((value) => value.id)).toEqual(["dependent"]);
    expect(f.calls).toHaveLength(7);
    revision = "newer-selected-revision";
    expect((yield* client.read("selected")).updatedAt).toBe(revision);
  }).pipe(Effect.provide(f.layer));
});

it.effect.each(["missing cursor", "repeated cursor", "missing collection"])(
  "fails incomplete selected reads with %s",
  (failure) => {
    const f = fixture((query) => ({
      data: {
        issue: query.includes("$after")
          ? failure === "missing collection"
            ? {}
            : { comments: page([], true, "next") }
          : {
              ...issue("ticket"),
              comments: page([], true, failure === "missing cursor" ? null : "next"),
            },
      },
    }));
    return Effect.gen(function* () {
      yield* (yield* Linear.LinearClient).read("ticket").pipe(Effect.flip);
      expect(f.calls.every((call) => !call.query.includes("mutation"))).toBe(true);
    }).pipe(Effect.provide(f.layer));
  },
);

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

it.effect("connects within Linear's query budget without dropping paginated metadata", () => {
  const teams = Array.from({ length: 12 }, (_, index) => ({
    id: `team-${index}`,
    name: `Team ${index}`,
    states: {
      nodes: [{ id: `refined-${index}`, name: "Refined", type: "unstarted" }],
    },
    labels: page([{ id: `label-${index}`, name: `Label ${index}` }], index === 0, "labels-next"),
  }));
  const projects = teams.map((team, index) => ({
    id: `project-${index}`,
    name: `Project ${index}`,
    teams: { nodes: [{ id: team.id, name: team.name }] },
    status: { type: index === 0 ? "canceled" : index === 1 ? "completed" : "backlog" },
  }));
  const f = fixture((query, variables) => {
    if (query.includes("team(id:"))
      return {
        data: {
          team: { labels: page([{ id: "extra", name: "Extra label" }], false, "labels-end") },
        },
      };
    const request = query.match(/\b(teams|projects)\(first:(\d+)/)!;
    const size = Number(request[2]);
    // Linear charges at least 1.2 points per nested id/name node, multiplies
    // connection sizes, and rejects queries above 10,000 points. An omitted
    // page size defaults to 50. This lower bound already rejects the old query.
    // https://linear.app/developers/rate-limiting#understanding-query-complexity
    const nested = [
      ...query.matchAll(/\b(?:labels|states|teams|initiatives)(?:\(first:(\d+)\))?\s*\{\s*nodes/g),
    ];
    const minimumCost = size * nested.reduce((sum, match) => sum + Number(match[1] ?? 50) * 1.2, 0);
    if (minimumCost > 10_000)
      return { status: 400, errors: [{ message: "Query complexity limit exceeded" }] };
    const values = request[1] === "teams" ? teams : projects;
    const start = Number(variables.after ?? 0);
    const end = start + size;
    return {
      data: { [request[1]!]: page(values.slice(start, end), end < values.length, String(end)) },
    };
  });
  return Effect.gen(function* () {
    const connection = yield* (yield* Linear.LinearClient).connect("secret-test-key");
    expect(connection.connected).toBe(true);
    expect(connection.teams.map((team) => team.id)).toEqual(teams.map((team) => team.id));
    expect(connection.projects.map((project) => project.id)).toEqual(
      projects.slice(2).map((project) => project.id),
    );
    expect(connection.teams[0]?.labels.map((label) => label.id)).toEqual(["label-0", "extra"]);
    expect(connection.teams[11]?.refinedStateId).toBe("refined-11");
    expect(connection.projects.at(-1)?.initiatives).toEqual([]);
    expect(f.stored).toHaveLength(1);
    expect(f.calls.every((call) => !call.query.includes("mutation"))).toBe(true);
  }).pipe(Effect.provide(f.layer));
});

it.effect(
  "shares workspace metadata across concurrent panels and refreshes it after one minute",
  () => {
    let projectName = "Original";
    const f = fixture((query) => ({
      data: query.includes("teams(first:")
        ? { teams: page([]) }
        : {
            projects: page([
              {
                id: "project",
                name: projectName,
                teams: { nodes: [] },
                status: { type: "started" },
              },
            ]),
          },
    }));
    return Effect.gen(function* () {
      const client = yield* Linear.LinearClient;
      const connections = yield* Effect.all(
        Array.from({ length: 6 }, () => client.connection({ cached: true })),
        { concurrency: "unbounded" },
      );
      expect(connections.every((connection) => connection.projects[0]?.name === "Original")).toBe(
        true,
      );
      expect(f.calls).toHaveLength(2);
      projectName = "Renamed";
      expect((yield* client.connection({ cached: true })).projects[0]?.name).toBe("Original");
      yield* TestClock.adjust("61 seconds");
      expect((yield* client.connection({ cached: true })).projects[0]?.name).toBe("Renamed");
      expect(f.calls).toHaveLength(4);
      projectName = "Completed elsewhere";
      expect((yield* client.connection()).projects[0]?.name).toBe("Completed elsewhere");
      expect(f.calls).toHaveLength(6);
    }).pipe(Effect.provide(f.layer));
  },
);

it.effect(
  "invalidates metadata when reconnecting or disconnecting and does not cache failures",
  () => {
    let refused = true;
    const f = fixture((query) =>
      refused
        ? { status: 401 }
        : { data: query.includes("teams(first:") ? { teams: page([]) } : { projects: page([]) } },
    );
    return Effect.gen(function* () {
      const client = yield* Linear.LinearClient;
      yield* client.connection({ cached: true }).pipe(Effect.flip);
      refused = false;
      expect((yield* client.connection({ cached: true })).connected).toBe(true);
      expect(f.calls).toHaveLength(3);
      yield* client.connect("secret-test-key");
      yield* client.connection({ cached: true });
      expect(f.calls).toHaveLength(7);
      yield* client.disconnect;
      expect((yield* client.connection({ cached: true })).connected).toBe(false);
      expect(f.calls).toHaveLength(7);
    }).pipe(Effect.provide(f.layer));
  },
);

it.effect.each([
  { status: 429, headers: { "retry-after": "2" } },
  {
    status: 400,
    errors: [{ extensions: { code: "RATELIMITED" } }],
    headers: { "retry-after": "2" },
  },
  {
    status: 200,
    errors: [{ extensions: { code: "RATELIMITED" } }],
    headers: { "x-ratelimit-requests-remaining": "0", "x-ratelimit-requests-reset": "2000" },
  },
])("recovers a rate-limited read after its cooldown without another Refresh, %j", (limited) =>
  Effect.gen(function* () {
    const f = fixture(() =>
      f.calls.length === 1 ? limited : { data: { issue: issue("ticket") } },
    );
    const client = yield* Linear.LinearClient.pipe(Effect.provide(f.layer));
    const pending = yield* client.read("ticket").pipe(Effect.forkChild);
    yield* TestClock.adjust("1 second");
    expect(f.calls).toHaveLength(1);
    yield* TestClock.adjust("1 second");
    expect((yield* Fiber.join(pending)).id).toBe("ticket");
    expect(f.calls).toHaveLength(2);
  }),
);

it.effect("bounds retries and holds other reads until the shared cooldown ends", () => {
  let limited = true;
  const f = fixture(() => (limited ? { status: 429 } : { data: { issue: issue("other") } }));
  return Effect.gen(function* () {
    const client = yield* Linear.LinearClient;
    const pending = yield* client.read("ticket").pipe(Effect.flip, Effect.forkChild);
    yield* TestClock.adjust("3 seconds");
    expect((yield* Fiber.join(pending)).message).toContain("Refresh again");
    expect(f.calls).toHaveLength(3);
    limited = false;
    const other = yield* client.read("other").pipe(Effect.forkChild);
    yield* TestClock.adjust("3 seconds");
    expect(f.calls).toHaveLength(3);
    yield* TestClock.adjust("1 second");
    expect((yield* Fiber.join(other)).id).toBe("other");
    expect(f.calls).toHaveLength(4);
  }).pipe(Effect.provide(f.layer));
});

it.effect.each([429, 400])(
  "does not retry before a long server cooldown or cache the failed connection, HTTP %i",
  (status) => {
    let limited = true;
    const f = fixture((query) =>
      limited
        ? {
            status,
            errors: [{ extensions: { code: "RATELIMITED" } }],
            headers: { "retry-after": "60" },
          }
        : { data: query.includes("teams(first:") ? { teams: page([]) } : { projects: page([]) } },
    );
    return Effect.gen(function* () {
      const client = yield* Linear.LinearClient;
      yield* client.connection({ cached: true }).pipe(Effect.flip);
      yield* client.connection({ cached: true }).pipe(Effect.flip);
      expect(f.calls).toHaveLength(1);
      limited = false;
      yield* TestClock.adjust("60 seconds");
      expect((yield* client.connection({ cached: true })).connected).toBe(true);
      expect(f.calls).toHaveLength(3);
    }).pipe(Effect.provide(f.layer));
  },
);

it.effect.each(["disconnect", "reconnect"] as const)(
  "does not restore old metadata when an in-flight read finishes after %s",
  (change) =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      let delayed = false;
      const f = fixture((query, _variables, credential) => {
        const response = {
          data: query.includes("teams(first:")
            ? { teams: page([]) }
            : {
                projects: page([
                  {
                    id: credential,
                    name: credential,
                    teams: { nodes: [] },
                    status: { type: "started" },
                  },
                ]),
              },
        };
        if (credential === "secret-test-key" && query.includes("projects(first:") && !delayed) {
          delayed = true;
          return Effect.gen(function* () {
            yield* Deferred.succeed(started, undefined);
            yield* Deferred.await(release);
            return response;
          });
        }
        return response;
      });
      return yield* Effect.gen(function* () {
        const client = yield* Linear.LinearClient;
        const pending = yield* client.connection({ cached: true }).pipe(Effect.forkChild);
        yield* Deferred.await(started);
        if (change === "disconnect") yield* client.disconnect;
        else yield* client.connect("secret-test-key-other");
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(pending);
        const current = yield* client.connection({ cached: true });
        expect(current.connected).toBe(change === "reconnect");
        expect(current.projects.map((project) => project.name)).toEqual(
          change === "reconnect" ? ["secret-test-key-other"] : [],
        );
      }).pipe(Effect.provide(f.layer));
    }),
);

it.effect("keeps the original key's cooldown after a different key is rate limited", () => {
  const f = fixture(() => ({ status: 429, headers: { "retry-after": "60" } }));
  return Effect.gen(function* () {
    const client = yield* Linear.LinearClient;
    yield* client.read("ticket").pipe(Effect.flip);
    yield* client.connect("secret-test-key-other").pipe(Effect.flip);
    expect(f.calls).toHaveLength(2);
    yield* client.read("ticket").pipe(Effect.flip);
    expect(f.calls).toHaveLength(2);
    expect(f.stored).toHaveLength(0);
  }).pipe(Effect.provide(f.layer));
});
