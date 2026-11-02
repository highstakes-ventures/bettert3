import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import * as Schema from "effect/Schema";
export const TodoFrontendRequest = Schema.Struct({
  path: TrimmedNonEmptyString.check(Schema.isMaxLength(2000)),
  method: Schema.Literals(["GET", "POST", "PUT"]),
  body: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(1_048_576))),
});
export type TodoFrontendRequest = typeof TodoFrontendRequest.Type;
export const TodoFrontendResponse = Schema.Struct({ status: Schema.Number, body: Schema.String });
export type TodoFrontendResponse = typeof TodoFrontendResponse.Type;
export const TodoFrontendPage = Schema.Struct({ html: Schema.String });
