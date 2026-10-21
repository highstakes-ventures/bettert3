import {
  WorkflowError,
  type WorkflowConnection,
  type WorkflowTicket,
  type WorkflowTicketDraft,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";

const SECRET = "workflow-linear-api-key";
const decodeEnvelope = Schema.decodeUnknownEffect(
  Schema.Struct({
    data: Schema.optional(Schema.Unknown),
    errors: Schema.optional(Schema.Array(Schema.Unknown)),
  }),
);
const Node = Schema.Struct({ id: Schema.String, name: Schema.String });
const pageInfo = Schema.Struct({
  hasNextPage: Schema.Boolean,
  endCursor: Schema.NullOr(Schema.String),
});
const page = <S extends Schema.Top>(node: S) =>
  Schema.Struct({ nodes: Schema.Array(node), pageInfo });
const Project = Schema.Struct({
  ...Node.fields,
  teams: Schema.Struct({ nodes: Schema.Array(Node) }),
  initiatives: Schema.Struct({ nodes: Schema.Array(Node) }),
});
const Reference = Schema.Struct({
  id: Schema.String,
  identifier: Schema.String,
  title: Schema.String,
  url: Schema.String,
  state: Schema.Struct({ id: Schema.String, type: Schema.String }),
});
const Outgoing = Schema.Struct({ id: Schema.String, type: Schema.String, relatedIssue: Reference });
const Incoming = Schema.Struct({ id: Schema.String, type: Schema.String, issue: Reference });
const Comment = Schema.Struct({
  id: Schema.String,
  body: Schema.String,
  createdAt: Schema.String,
  user: Schema.NullOr(Node),
});
const Resource = Schema.Struct({ title: Schema.String, url: Schema.String });
const Issue = Schema.Struct({
  ...Reference.fields,
  updatedAt: Schema.String,
  description: Schema.NullOr(Schema.String),
  team: Node,
  project: Schema.NullOr(Project),
  priority: Schema.Number,
  estimate: Schema.NullOr(Schema.Number),
  dueDate: Schema.NullOr(Schema.String),
  labels: page(Node),
  relations: page(Outgoing),
  inverseRelations: page(Incoming),
  comments: page(Comment),
  attachments: page(Resource),
});
const projectFields = "id name teams { nodes { id name } } initiatives { nodes { id name } }";
const referenceFields = "id identifier title url state { id type }";
const pageFields = "pageInfo { hasNextPage endCursor }";
const collectionFields = {
  labels: "id name",
  relations: `id type relatedIssue { ${referenceFields} }`,
  inverseRelations: `id type issue { ${referenceFields} }`,
  comments: "id body createdAt user { id name }",
  attachments: "title url",
};
const issueFields = `${referenceFields} updatedAt description priority estimate dueDate team { id name } project { ${projectFields} }
  ${Object.entries(collectionFields)
    .map(([key, fields]) => `${key}(first:100) { nodes { ${fields} } ${pageFields} }`)
    .join("\n")}`;
const project = (value: typeof Project.Type) => ({
  id: value.id,
  name: value.name,
  teamIds: value.teams.nodes.map((team) => team.id),
  initiatives: value.initiatives.nodes.map((initiative) => initiative.name),
});
const reference = (value: typeof Reference.Type) => ({
  id: value.id,
  identifier: value.identifier,
  title: value.title,
  url: value.url,
  stateType: value.state.type,
});

export class LinearClient extends Context.Service<
  LinearClient,
  {
    readonly connected: Effect.Effect<boolean, WorkflowError>;
    readonly connect: (key: string) => Effect.Effect<WorkflowConnection, WorkflowError>;
    readonly disconnect: Effect.Effect<void, WorkflowError>;
    readonly connection: () => Effect.Effect<WorkflowConnection, WorkflowError>;
    readonly read: (id: string) => Effect.Effect<WorkflowTicket, WorkflowError>;
    readonly search: (
      teamId: string,
      query: string,
    ) => Effect.Effect<ReadonlyArray<WorkflowTicket>, WorkflowError>;
    readonly save: (input: {
      id: string;
      teamId: string;
      draft: WorkflowTicketDraft;
      create: boolean;
      expectedUpdatedAt?: string;
    }) => Effect.Effect<WorkflowTicket, WorkflowError>;
    readonly decide: (
      id: string,
      stateId: string,
      projectId?: string | null,
    ) => Effect.Effect<WorkflowTicket, WorkflowError>;
  }
>()("t3/workflows/LinearClient") {}

const make = Effect.gen(function* () {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const http = yield* HttpClient.HttpClient;
  const key = secrets
    .get(SECRET)
    .pipe(
      Effect.mapError(
        (cause) => new WorkflowError({ message: "Could not read the Linear connection.", cause }),
      ),
    );
  const request = Effect.fn("LinearClient.request")(function* <S extends Schema.Top>(
    query: string,
    variables: object,
    schema: S,
    suppliedKey?: string,
  ) {
    const credential =
      suppliedKey ??
      Option.match(yield* key, {
        onNone: () => "",
        onSome: (bytes) => new TextDecoder().decode(bytes),
      });
    if (!credential)
      return yield* new WorkflowError({ message: "Connect Linear before starting a workflow." });
    const response = yield* http
      .execute(
        HttpClientRequest.post("https://api.linear.app/graphql").pipe(
          HttpClientRequest.setHeaders({
            authorization: credential,
            "content-type": "application/json",
          }),
          HttpClientRequest.bodyJsonUnsafe({ query, variables }),
        ),
      )
      .pipe(
        Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
        Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
        Effect.timeout("30 seconds"),
        Effect.mapError(
          (cause) => new WorkflowError({ message: "Could not reach Linear.", cause }),
        ),
      );
    if (response.status === 401 || response.status === 403)
      return yield* new WorkflowError({
        message: "Linear refused this connection. Check its credentials and permissions.",
      });
    if (response.status === 429)
      return yield* new WorkflowError({
        message: "Linear is rate limiting requests. The workflow will retry later.",
      });
    if (response.status < 200 || response.status >= 300)
      return yield* new WorkflowError({ message: "Linear could not complete this request." });
    const body = yield* response.json.pipe(
      Effect.mapError(
        (cause) => new WorkflowError({ message: "Linear returned an unreadable response.", cause }),
      ),
    );
    const envelope = yield* decodeEnvelope(body).pipe(
      Effect.mapError(
        (cause) => new WorkflowError({ message: "Linear returned an invalid response.", cause }),
      ),
    );
    if (envelope.errors?.length)
      return yield* new WorkflowError({
        message:
          "Linear rejected the request. Check the connection's access and workflow configuration.",
      });
    return yield* Schema.decodeUnknownEffect(schema)(envelope.data).pipe(
      Effect.mapError(
        (cause) =>
          new WorkflowError({
            message: "Linear returned data that did not match the expected contract.",
            cause,
          }),
      ),
    );
  });
  const readRaw = (id: string) =>
    request(
      `query($id:String!){ issue(id:$id){ ${issueFields} } }`,
      { id },
      Schema.Struct({ issue: Issue }),
    ).pipe(Effect.map((data) => data.issue));
  const remaining = Effect.fn("LinearClient.remaining")(function* <S extends Schema.Top>(
    id: string,
    name: keyof typeof collectionFields,
    schema: S,
    initial: { readonly nodes: ReadonlyArray<S["Type"]>; readonly pageInfo: typeof pageInfo.Type },
  ) {
    const nodes = [...initial.nodes];
    let cursor = initial.pageInfo;
    while (cursor.hasNextPage) {
      if (cursor.endCursor === null)
        return yield* new WorkflowError({
          message: "Linear returned an invalid pagination cursor.",
        });
      const data = yield* request(
        `query($id:String!,$after:String!){issue(id:$id){ ${name}(first:100,after:$after){ nodes { ${collectionFields[name]} } ${pageFields} } }}`,
        { id, after: cursor.endCursor },
        Schema.Struct({ issue: Schema.Record(Schema.String, page(schema)) }),
      );
      const next = data.issue[name];
      if (!next || next.pageInfo.endCursor === cursor.endCursor)
        return yield* new WorkflowError({
          message: "Linear did not advance the ticket pagination cursor.",
        });
      nodes.push(...next.nodes);
      cursor = next.pageInfo;
    }
    return nodes;
  });
  const read = Effect.fn("LinearClient.read")(function* (id: string) {
    const raw = yield* readRaw(id);
    const labels = yield* remaining(id, "labels", Node, raw.labels);
    const outgoing = yield* remaining(id, "relations", Outgoing, raw.relations);
    const incoming = yield* remaining(id, "inverseRelations", Incoming, raw.inverseRelations);
    const comments = yield* remaining(id, "comments", Comment, raw.comments);
    const resources = yield* remaining(id, "attachments", Resource, raw.attachments);
    return {
      ...reference(raw),
      stateId: raw.state.id,
      updatedAt: raw.updatedAt,
      description: raw.description ?? "",
      teamId: raw.team.id,
      project: raw.project === null ? null : project(raw.project),
      priority: raw.priority,
      estimate: raw.estimate,
      dueDate: raw.dueDate,
      labels,
      blockedBy: incoming
        .filter((relation) => relation.type === "blocks")
        .map((relation) => reference(relation.issue)),
      blocks: outgoing
        .filter((relation) => relation.type === "blocks")
        .map((relation) => reference(relation.relatedIssue)),
      resources,
      comments: comments.map((comment) => ({
        id: comment.id,
        body: comment.body,
        author: comment.user?.name ?? "Deleted user",
        createdAt: comment.createdAt,
      })),
    } satisfies WorkflowTicket;
  });
  const connection = Effect.fn("LinearClient.connection")(function* (suppliedKey?: string) {
    if (suppliedKey === undefined && Option.isNone(yield* key))
      return { connected: false, teams: [], projects: [] } satisfies WorkflowConnection;
    const Team = Schema.Struct({
      ...Node.fields,
      states: Schema.Struct({
        nodes: Schema.Array(Schema.Struct({ ...Node.fields, type: Schema.String })),
      }),
      labels: page(Node),
    });
    const load = <S extends Schema.Top>(name: "teams" | "projects", fields: string, schema: S) =>
      Effect.gen(function* () {
        const nodes: Array<S["Type"]> = [];
        let after: string | null = null;
        do {
          const result: {
            readonly [key: string]: {
              readonly nodes: ReadonlyArray<S["Type"]>;
              readonly pageInfo: typeof pageInfo.Type;
            };
          } = yield* request(
            // Nested labels, teams and initiatives multiply Linear's query
            // complexity. Small parent pages stay below its 10,000-point cap.
            `query($after:String){${name}(first:10,after:$after){nodes{${fields}} ${pageFields}}}`,
            { after },
            Schema.Record(Schema.String, page(schema)),
            suppliedKey,
          );
          const data = result[name];
          if (
            !data ||
            (data.pageInfo.hasNextPage &&
              (!data.pageInfo.endCursor || data.pageInfo.endCursor === after))
          )
            return yield* new WorkflowError({
              message: "Could not paginate the Linear workspace.",
            });
          nodes.push(...data.nodes);
          after = data.pageInfo.hasNextPage ? data.pageInfo.endCursor : null;
        } while (after !== null);
        return nodes;
      });
    const teams = yield* load(
      "teams",
      "id name states { nodes { id name type } } labels(first:100) { nodes { id name } pageInfo { hasNextPage endCursor } }",
      Team,
    );
    const projects = yield* load("projects", projectFields, Project);
    const teamLabels = new Map<string, ReadonlyArray<typeof Node.Type>>();
    for (const team of teams) {
      const labels = [...team.labels.nodes];
      let cursor = team.labels.pageInfo;
      while (cursor.hasNextPage) {
        const next = yield* request(
          "query($id:String!,$after:String!){team(id:$id){labels(first:100,after:$after){nodes{id name} pageInfo{hasNextPage endCursor}}}}",
          { id: team.id, after: cursor.endCursor },
          Schema.Struct({ team: Schema.Struct({ labels: page(Node) }) }),
          suppliedKey,
        );
        if (
          !next.team.labels.pageInfo.endCursor ||
          next.team.labels.pageInfo.endCursor === cursor.endCursor
        )
          return yield* new WorkflowError({ message: "Could not paginate Linear labels." });
        labels.push(...next.team.labels.nodes);
        cursor = next.team.labels.pageInfo;
      }
      teamLabels.set(team.id, labels);
    }
    return {
      connected: true,
      teams: teams.map((team) => ({
        id: team.id,
        name: team.name,
        labels: teamLabels.get(team.id) ?? [],
        refinedStateId: team.states.nodes.find((state) => state.name === "Refined")?.id ?? null,
        canceledStateId:
          team.states.nodes.find((state) => state.type === "canceled" && state.name === "Canceled")
            ?.id ??
          team.states.nodes.find((state) => state.type === "canceled")?.id ??
          null,
        completedStateId:
          team.states.nodes.find((state) => state.type === "completed" && state.name === "Done")
            ?.id ??
          team.states.nodes.find((state) => state.type === "completed")?.id ??
          null,
      })),
      projects: projects.map(project),
    } satisfies WorkflowConnection;
  });
  const changed = Schema.Struct({ success: Schema.Boolean });
  const mutate = (query: string, variables: object, name: string) =>
    request(query, variables, Schema.Record(Schema.String, changed)).pipe(
      Effect.flatMap((data) =>
        data[name]?.success
          ? Effect.void
          : Effect.fail(new WorkflowError({ message: "Linear did not confirm this update." })),
      ),
    );
  const save: LinearClient["Service"]["save"] = Effect.fn("LinearClient.save")(function* ({
    id,
    teamId,
    draft,
    create,
    expectedUpdatedAt,
  }) {
    if (draft.blockedBy.includes(id))
      return yield* new WorkflowError({ message: "A ticket cannot block itself." });
    if (!create) {
      const current = yield* readRaw(id);
      if (current.team.id !== teamId)
        return yield* new WorkflowError({ message: "This issue moved to another Linear team." });
      if (expectedUpdatedAt === undefined || current.updatedAt !== expectedUpdatedAt)
        return yield* new WorkflowError({
          message: "The ticket changed. Read it and submit its current revision before updating.",
        });
    }
    const input = {
      title: draft.title,
      description: draft.description,
      projectId: draft.targetProjectId,
      priority: draft.priority,
      labelIds: draft.labelIds,
    };
    // The runtime allocates the issue UUID before I/O. A lost create response is recoverable by UUID.
    const found = create
      ? yield* request(
          "query($id:ID!){issues(filter:{id:{eq:$id}},first:1){nodes{id team{id}}}}",
          { id },
          Schema.Struct({
            issues: Schema.Struct({
              nodes: Schema.Array(
                Schema.Struct({ id: Schema.String, team: Schema.Struct({ id: Schema.String }) }),
              ),
            }),
          }),
        )
      : null;
    if (found && found.issues.nodes.length > 0) {
      const existing = yield* read(id);
      if (existing.teamId !== teamId)
        return yield* new WorkflowError({ message: "This issue belongs to another Linear team." });
      const sameIds = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) =>
        JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());
      if (
        existing.title !== draft.title ||
        existing.description !== draft.description ||
        (existing.project?.id ?? null) !== draft.targetProjectId ||
        existing.priority !== draft.priority ||
        !sameIds(
          existing.labels.map((label) => label.id),
          draft.labelIds,
        ) ||
        !sameIds(
          existing.blockedBy.map((issue) => issue.id),
          draft.blockedBy,
        ) ||
        ["completed", "canceled"].includes(existing.stateType)
      )
        return yield* new WorkflowError({
          message:
            "A partially prepared ticket already exists with different content. Read it and submit a corrected result with its existingIssueId and current revision.",
        });
      // A create retry must never turn into an update of a potentially edited issue.
      return existing;
    }
    if (found)
      yield* mutate(
        "mutation($input:IssueCreateInput!){issueCreate(input:$input){success}}",
        { input: { ...input, id, teamId } },
        "issueCreate",
      );
    else {
      yield* mutate(
        "mutation($id:String!,$input:IssueUpdateInput!){issueUpdate(id:$id,input:$input){success}}",
        { id, input },
        "issueUpdate",
      );
    }
    const raw = yield* readRaw(id);
    const incoming = yield* remaining(id, "inverseRelations", Incoming, raw.inverseRelations);
    for (const relation of incoming.filter(
      (value) => value.type === "blocks" && !draft.blockedBy.includes(value.issue.id),
    )) {
      yield* mutate(
        "mutation($id:String!){issueRelationDelete(id:$id){success}}",
        { id: relation.id },
        "issueRelationDelete",
      );
    }
    for (const blocker of draft.blockedBy.filter(
      (value) =>
        !incoming.some((relation) => relation.type === "blocks" && relation.issue.id === value),
    )) {
      yield* mutate(
        "mutation($input:IssueRelationCreateInput!){issueRelationCreate(input:$input){success}}",
        { input: { issueId: blocker, relatedIssueId: id, type: "blocks" } },
        "issueRelationCreate",
      );
    }
    return yield* read(id);
  });
  return LinearClient.of({
    connected: key.pipe(Effect.map(Option.isSome)),
    connection: () => connection(),
    connect: (credential) =>
      connection(credential).pipe(
        Effect.tap(() =>
          secrets
            .set(SECRET, new TextEncoder().encode(credential))
            .pipe(
              Effect.mapError(
                (cause) =>
                  new WorkflowError({ message: "Could not save the Linear connection.", cause }),
              ),
            ),
        ),
      ),
    disconnect: secrets
      .remove(SECRET)
      .pipe(
        Effect.mapError(
          (cause) =>
            new WorkflowError({ message: "Could not remove the Linear connection.", cause }),
        ),
      ),
    read,
    save,
    search: (teamId, query) =>
      request(
        "query($filter:IssueFilter!){issues(first:30,filter:$filter){nodes{id}}}",
        {
          filter: {
            team: { id: { eq: teamId } },
            or: [
              { title: { containsIgnoreCase: query } },
              { description: { containsIgnoreCase: query } },
            ],
          },
        },
        Schema.Struct({
          issues: Schema.Struct({ nodes: Schema.Array(Schema.Struct({ id: Schema.String })) }),
        }),
      ).pipe(
        Effect.flatMap((data) =>
          Effect.forEach(data.issues.nodes, (issue) => read(issue.id), { concurrency: 3 }),
        ),
      ),
    decide: (id, stateId, projectId) =>
      mutate(
        "mutation($id:String!,$input:IssueUpdateInput!){issueUpdate(id:$id,input:$input){success}}",
        { id, input: { stateId, ...(projectId === undefined ? {} : { projectId }) } },
        "issueUpdate",
      ).pipe(Effect.andThen(read(id))),
  });
});

export const layer = Layer.effect(LinearClient, make);
