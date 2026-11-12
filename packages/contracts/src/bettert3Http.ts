import {
  MarketingStudioRequest,
  MarketingStudioResponse,
  MarketingReleaseCollectionRequest,
} from "./marketing.ts";
import { TodoFrontendPage, TodoFrontendRequest, TodoFrontendResponse } from "./todo.ts";
import {
  ExecutionCapabilities,
  ExecutionLookup,
  ExecutionRequestInput,
  ExecutionRequestParams,
  ExecutionResult,
} from "./executionRequest.ts";
import { PaiWidgetPage, PaiWidgetRequest, PaiWidgetResponse } from "./pai.ts";
import {
  MationFrontendPage,
  MationFrontendRequest,
  MationFrontendResponse,
  MationExecution,
  MationExecutionInput,
  MationExecutionQuery,
  MationProjects,
  MationRequestId,
} from "./mation.ts";
import * as Schema from "effect/Schema";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import {
  EnvironmentHttpApi,
  EnvironmentAuthenticatedAuth,
  OptionalBearerHeaders,
  EnvironmentOrchestrationThreadSnapshotErrors,
  EnvironmentOrchestrationThreadHistoryErrors,
} from "./environmentHttp.ts";

class EnvironmentExecutionsHttpApi extends HttpApiGroup.make("executions")
  .add(
    HttpApiEndpoint.get("capabilities", "/api/executions/capabilities", {
      headers: OptionalBearerHeaders,
      success: ExecutionCapabilities,
      error: EnvironmentOrchestrationThreadSnapshotErrors,
    }).middleware(EnvironmentAuthenticatedAuth),
  )
  .add(
    HttpApiEndpoint.get("get", "/api/executions/:commandId", {
      headers: OptionalBearerHeaders,
      params: ExecutionRequestParams,
      query: ExecutionLookup,
      success: ExecutionResult,
      error: EnvironmentOrchestrationThreadHistoryErrors,
    }).middleware(EnvironmentAuthenticatedAuth),
  )
  .add(
    HttpApiEndpoint.put("start", "/api/executions/:commandId", {
      headers: OptionalBearerHeaders,
      params: ExecutionRequestParams,
      payload: ExecutionRequestInput,
      success: ExecutionResult,
      error: EnvironmentOrchestrationThreadHistoryErrors,
    }).middleware(EnvironmentAuthenticatedAuth),
  ) {}

export class ExecutionHttpApi extends HttpApi.make("executions").add(
  EnvironmentExecutionsHttpApi,
) {}

class EnvironmentTodoHttpApi extends HttpApiGroup.make("todo")
  .add(
    HttpApiEndpoint.get("page", "/api/todo/page", {
      headers: OptionalBearerHeaders,
      success: TodoFrontendPage,
      error: EnvironmentOrchestrationThreadHistoryErrors,
    }).middleware(EnvironmentAuthenticatedAuth),
  )
  .add(
    HttpApiEndpoint.post("frontendRequest", "/api/todo/request", {
      headers: OptionalBearerHeaders,
      payload: TodoFrontendRequest,
      success: TodoFrontendResponse,
      error: EnvironmentOrchestrationThreadHistoryErrors,
    }).middleware(EnvironmentAuthenticatedAuth),
  ) {}

class EnvironmentMationHttpApi extends HttpApiGroup.make("mation")
  .add(
    HttpApiEndpoint.get("page", "/api/mation/page", {
      headers: OptionalBearerHeaders,
      success: MationFrontendPage,
      error: EnvironmentOrchestrationThreadHistoryErrors,
    }).middleware(EnvironmentAuthenticatedAuth),
  )
  .add(
    HttpApiEndpoint.post("frontendRequest", "/api/mation/request", {
      headers: OptionalBearerHeaders,
      payload: MationFrontendRequest,
      success: MationFrontendResponse,
      error: EnvironmentOrchestrationThreadHistoryErrors,
    }).middleware(EnvironmentAuthenticatedAuth),
  )
  .add(
    HttpApiEndpoint.get("projects", "/api/mation/projects", {
      headers: OptionalBearerHeaders,
      success: MationProjects,
      error: EnvironmentOrchestrationThreadSnapshotErrors,
    }).middleware(EnvironmentAuthenticatedAuth),
  )
  .add(
    HttpApiEndpoint.get("execution", "/api/mation/executions/:requestId", {
      headers: OptionalBearerHeaders,
      params: Schema.Struct({ requestId: MationRequestId }),
      query: MationExecutionQuery,
      success: MationExecution,
      error: EnvironmentOrchestrationThreadHistoryErrors,
    }).middleware(EnvironmentAuthenticatedAuth),
  )
  .add(
    HttpApiEndpoint.put("startExecution", "/api/mation/executions/:requestId", {
      headers: OptionalBearerHeaders,
      params: Schema.Struct({ requestId: MationRequestId }),
      payload: MationExecutionInput,
      success: MationExecution,
      error: EnvironmentOrchestrationThreadHistoryErrors,
    }).middleware(EnvironmentAuthenticatedAuth),
  ) {}

class EnvironmentPaiHttpApi extends HttpApiGroup.make("pai")
  .add(
    HttpApiEndpoint.get("page", "/api/pai/page", {
      headers: OptionalBearerHeaders,
      success: PaiWidgetPage,
      error: EnvironmentOrchestrationThreadHistoryErrors,
    }).middleware(EnvironmentAuthenticatedAuth),
  )
  .add(
    HttpApiEndpoint.post("request", "/api/pai/request", {
      headers: OptionalBearerHeaders,
      payload: PaiWidgetRequest,
      success: PaiWidgetResponse,
      error: EnvironmentOrchestrationThreadHistoryErrors,
    }).middleware(EnvironmentAuthenticatedAuth),
  ) {}

class EnvironmentMarketingHttpApi extends HttpApiGroup.make("marketing")
  .add(
    HttpApiEndpoint.post("studio", "/api/marketing/studio", {
      headers: OptionalBearerHeaders,
      payload: MarketingStudioRequest,
      success: MarketingStudioResponse,
      error: EnvironmentOrchestrationThreadHistoryErrors,
    }).middleware(EnvironmentAuthenticatedAuth),
  )
  .add(
    HttpApiEndpoint.post("collect", "/api/marketing/releases/collect", {
      headers: OptionalBearerHeaders,
      payload: MarketingReleaseCollectionRequest,
      success: Schema.Struct({ imported: Schema.Number, checkedAt: Schema.String }),
      error: EnvironmentOrchestrationThreadHistoryErrors,
    }).middleware(EnvironmentAuthenticatedAuth),
  ) {}

export class BetterT3HttpApi extends HttpApi.make("bettert3")
  .add(EnvironmentMationHttpApi)
  .add(EnvironmentMarketingHttpApi)
  .add(EnvironmentTodoHttpApi)
  .add(EnvironmentPaiHttpApi) {}

export const BetterT3EnvironmentHttpApi = EnvironmentHttpApi.addHttpApi(BetterT3HttpApi);
