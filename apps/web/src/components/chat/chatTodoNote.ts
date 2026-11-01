import type { OrchestrationV2ConversationMessage } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

export function chatTodoNote(
  title: string,
  messages: readonly OrchestrationV2ConversationMessage[],
): string {
  const heading = `Follow up on ${title.slice(0, 180)}.\nRecent conversation, oldest first:\n`;
  const excerpts: string[] = [];
  let remaining = 5000 - heading.length;
  for (const message of messages.toReversed()) {
    if (
      message.role === "system" ||
      message.notification ||
      message.workflowScript ||
      !message.text.trim()
    )
      continue;
    const excerpt = `${message.role} ${DateTime.formatIso(message.createdAt)}: ${message.text.slice(0, 1200)}\n`;
    if (excerpt.length + 1 > remaining) break;
    excerpts.unshift(excerpt);
    remaining -= excerpt.length + 1;
    if (excerpts.length === 8) break;
  }
  return heading + excerpts.join("\n");
}
