import * as Schema from "effect/Schema";
import { MationExecutionInput } from "./mation.ts";
export {
  AgentCommand as MarketingAgentCommand,
  AgentInput as MarketingAgentInput,
  HumanCommand as MarketingHumanCommand,
  StudioRequest as MarketingStudioRequest,
  StudioResponse as MarketingStudioResponse,
} from "@highstakes/marketing/contracts";

export const MarketingReleaseCollectionRequest = Schema.Struct({
  ...MationExecutionInput.fields,
  releaseId: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^\d+$/))),
});
export type MarketingReleaseCollectionRequest = typeof MarketingReleaseCollectionRequest.Type;
