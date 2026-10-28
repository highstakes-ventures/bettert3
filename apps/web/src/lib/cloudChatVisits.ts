export function cloudChatVisitKey(environmentId: string, accountId: string, threadId: string) {
  return JSON.stringify(["cloud", environmentId, accountId, threadId]);
}
