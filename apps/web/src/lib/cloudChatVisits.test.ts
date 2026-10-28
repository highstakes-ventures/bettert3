import { describe, expect, it } from "vite-plus/test";
import { cloudChatVisitKey } from "./cloudChatVisits";

describe("cloud chat visit keys", () => {
  it("isolates actual visits by environment, account, and conversation", () => {
    const key = cloudChatVisitKey("env", "account", "thread");
    expect(cloudChatVisitKey("other-env", "account", "thread")).not.toBe(key);
    expect(cloudChatVisitKey("env", "other-account", "thread")).not.toBe(key);
    expect(cloudChatVisitKey("env", "account", "other-thread")).not.toBe(key);
    expect(cloudChatVisitKey("env:a", "b", "thread")).not.toBe(
      cloudChatVisitKey("env", "a:b", "thread"),
    );
  });
});
