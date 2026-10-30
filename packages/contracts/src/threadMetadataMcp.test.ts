import { assert, describe, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { ProjectId } from "./baseSchemas.ts";
import { ThreadMetadataMcpUpdateInput } from "./threadMetadataMcp.ts";

const decodeUpdate = Schema.decodeUnknownSync(ThreadMetadataMcpUpdateInput);

describe("ThreadMetadataMcpUpdateInput", () => {
  it("decodes each metadata action with only its required fields", () => {
    assert.deepEqual(decodeUpdate({ action: "rename", title: "Release follow-up" }), {
      action: "rename",
      title: "Release follow-up",
    });
    assert.deepEqual(decodeUpdate({ action: "regenerate_title" }), {
      action: "regenerate_title",
    });
    assert.deepEqual(
      decodeUpdate({
        action: "link_pull_request",
        pullRequest: {
          repository: "pingdotgg/t3code",
          number: 8689,
          url: "https://github.com/pingdotgg/t3code/pull/8689",
        },
      }),
      {
        action: "link_pull_request",
        pullRequest: {
          repository: "pingdotgg/t3code",
          number: 8689,
          url: "https://github.com/pingdotgg/t3code/pull/8689",
        },
      },
    );
    assert.deepEqual(decodeUpdate({ action: "unlink_pull_request" }), {
      action: "unlink_pull_request",
    });
  });

  it("requires an explicit project section or null for assignment", () => {
    assert.deepEqual(decodeUpdate({ action: "set_section", sectionId: "build" }), {
      action: "set_section",
      sectionId: "build",
    });
    assert.deepEqual(decodeUpdate({ action: "set_section", sectionId: null }), {
      action: "set_section",
      sectionId: null,
    });
    assert.throws(() => decodeUpdate({ action: "set_section" }));
    assert.throws(() =>
      decodeUpdate({ action: "set_section", sectionId: "build", title: "Other" }),
    );
    assert.throws(() => decodeUpdate({ action: "rename", title: "Other", sectionId: "build" }));
  });

  it("rejects missing action data and fields from another action", () => {
    assert.throws(() => decodeUpdate({ action: "rename" }));
    assert.throws(() => decodeUpdate({ action: "regenerate_title", title: "Not allowed" }));
    assert.throws(() => decodeUpdate({ action: "link_pull_request" }));
    assert.throws(() =>
      decodeUpdate({
        action: "unlink_pull_request",
        pullRequest: {
          repository: "pingdotgg/t3code",
          number: 8689,
          url: "https://github.com/pingdotgg/t3code/pull/8689",
        },
      }),
    );
  });

  it("requires both project IDs and rejects mixed move payloads", () => {
    assert.deepEqual(
      decodeUpdate({
        action: "move_to_project",
        sourceProjectId: "old",
        targetProjectId: "current",
      }),
      {
        action: "move_to_project",
        sourceProjectId: ProjectId.make("old"),
        targetProjectId: ProjectId.make("current"),
      },
    );
    assert.throws(() => decodeUpdate({ action: "move_to_project", targetProjectId: "current" }));
    assert.throws(() =>
      decodeUpdate({
        action: "move_to_project",
        sourceProjectId: "old",
        targetProjectId: "current",
        title: "Other",
      }),
    );
    assert.throws(() =>
      decodeUpdate({ action: "rename", title: "Other", targetProjectId: "current" }),
    );
  });

  it("rejects unknown actions", () => {
    assert.throws(() => decodeUpdate({ action: "move_workspace" }));
  });

  it("rejects malformed client request ids without normalizing valid keys", () => {
    const validKey = "metadata-\ud83d\ude80-1";
    assert.equal(
      decodeUpdate({ action: "regenerate_title", clientRequestId: validKey }).clientRequestId,
      validKey,
    );
    assert.throws(() =>
      decodeUpdate({ action: "regenerate_title", clientRequestId: "metadata-\ud800" }),
    );
    assert.throws(() =>
      decodeUpdate({ action: "regenerate_title", clientRequestId: "metadata-\udc00" }),
    );
  });

  it("accepts HTTP(S) pull request URLs and rejects other or malformed URLs", () => {
    assert.deepEqual(
      decodeUpdate({
        action: "link_pull_request",
        pullRequest: {
          repository: "engineering/t3code",
          number: 42,
          url: "https://git.corp.example/engineering/t3code/pulls/42",
        },
      }).pullRequest,
      {
        repository: "engineering/t3code",
        number: 42,
        url: "https://git.corp.example/engineering/t3code/pulls/42",
      },
    );

    for (const url of ["not a URL", "javascript:alert(1)", "file:///tmp/pull-request"]) {
      assert.throws(() =>
        decodeUpdate({
          action: "link_pull_request",
          pullRequest: { repository: "pingdotgg/t3code", number: 8690, url },
        }),
      );
    }
  });
});
