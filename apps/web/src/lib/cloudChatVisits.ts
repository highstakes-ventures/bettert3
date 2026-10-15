import type { CloudChatSummary } from "@t3tools/contracts";

export function cloudChatVisitKey(environmentId: string, accountId: string, threadId: string) {
  return JSON.stringify(["cloud", environmentId, accountId, threadId]);
}

/** A kickoff stays new until its conversation has been opened successfully. */
export function isUnopenedAutomaticChat(
  chat: Pick<CloudChatSummary, "id" | "origin">,
  environmentId: string,
  accountId: string,
  visits: Readonly<Record<string, string>>,
) {
  return (
    chat.origin === "automatic" &&
    visits[cloudChatVisitKey(environmentId, accountId, chat.id)] === undefined
  );
}
