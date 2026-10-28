import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const PaiEmailItem = Schema.Struct({
  mailbox: TrimmedNonEmptyString.check(Schema.isMaxLength(320)),
  messageId: TrimmedNonEmptyString.check(Schema.isMaxLength(1000)),
  mailThreadId: TrimmedNonEmptyString.check(Schema.isMaxLength(1000)),
  sender: TrimmedNonEmptyString.check(Schema.isMaxLength(500)),
  subject: Schema.String.check(Schema.isMaxLength(1000)),
  summary: TrimmedNonEmptyString.check(Schema.isMaxLength(3000)),
  receivedAt: TrimmedNonEmptyString,
  sourceUrl: TrimmedNonEmptyString.check(
    Schema.isPattern(/^https:\/\/(mail\.google\.com|outlook\.office\.com|outlook\.live\.com)\//),
  ),
});
export const PaiPublishEmailInput = Schema.Struct({
  items: Schema.Array(PaiEmailItem).check(Schema.isMaxLength(200)),
});
export type PaiPublishEmailInput = typeof PaiPublishEmailInput.Type;
export const PaiWidgetReference = Schema.Struct({
  reportId: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
});
export type PaiWidgetReference = typeof PaiWidgetReference.Type;
export const PaiPublishEmailResult = Schema.Struct({
  published: Schema.Number,
  paiWidget: PaiWidgetReference,
});
export const PaiWidgetRequest = Schema.Struct({
  reportId: PaiWidgetReference.fields.reportId,
  method: Schema.Literals(["GET", "POST"]),
  body: Schema.optional(Schema.String.check(Schema.isMaxLength(100000))),
});
export type PaiWidgetRequest = typeof PaiWidgetRequest.Type;
export const PaiWidgetResponse = Schema.Struct({ status: Schema.Number, body: Schema.String });
export const PaiWidgetPage = Schema.Struct({ html: Schema.String });
export const PaiEmailWorkflow = Schema.Struct({ prompt: Schema.String });
export const PaiCompleteEmailActionInput = Schema.Struct({
  actionId: Schema.String.check(Schema.isPattern(/^[a-f0-9-]{36}$/)),
  message: TrimmedNonEmptyString.check(Schema.isMaxLength(3000)),
});
