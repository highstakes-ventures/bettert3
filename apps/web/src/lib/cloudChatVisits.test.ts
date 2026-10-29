import { describe, expect, it } from "vite-plus/test";
import { markThreadVisited, parsePersistedState } from "../uiStateStore";
import { cloudChatVisitKey, isUnopenedAutomaticChat } from "./cloudChatVisits";

describe("automatic cloud chat visits", () => {
  const chat = { id: "thread-1", origin: "automatic" as const };

  it("counts an automatic kickoff before it has completed or been opened", () => {
    expect(isUnopenedAutomaticChat(chat, "env", "account", {})).toBe(true);
    expect(isUnopenedAutomaticChat({ ...chat, origin: "user" }, "env", "account", {})).toBe(false);
    expect(isUnopenedAutomaticChat({ ...chat, origin: "unknown" }, "env", "account", {})).toBe(
      false,
    );
  });

  it("remembers opened chats after reloading persisted UI state and leaves other kickoffs new", () => {
    const state = markThreadVisited(
      parsePersistedState({}),
      cloudChatVisitKey("env", "account", chat.id),
      "2026-10-15T08:00:00Z",
    );
    const reloaded = parsePersistedState(JSON.parse(JSON.stringify(state)));

    expect(isUnopenedAutomaticChat(chat, "env", "account", reloaded.threadLastVisitedAtById)).toBe(
      false,
    );
    expect(
      isUnopenedAutomaticChat(
        { ...chat, id: "thread-2" },
        "env",
        "account",
        reloaded.threadLastVisitedAtById,
      ),
    ).toBe(true);
    // A later update to an already opened thread is not a new kickoff.
    const updated = { ...chat, updatedAt: 1792051200 };
    expect(
      isUnopenedAutomaticChat(updated, "env", "account", reloaded.threadLastVisitedAtById),
    ).toBe(false);
  });

  it("isolates visits by environment and Codex account", () => {
    const visits = { [cloudChatVisitKey("env", "account", chat.id)]: "2026-10-15T08:00:00Z" };
    expect(isUnopenedAutomaticChat(chat, "other-env", "account", visits)).toBe(true);
    expect(isUnopenedAutomaticChat(chat, "env", "other-account", visits)).toBe(true);
    expect(cloudChatVisitKey("env:a", "b", chat.id)).not.toBe(
      cloudChatVisitKey("env", "a:b", chat.id),
    );
  });
});
