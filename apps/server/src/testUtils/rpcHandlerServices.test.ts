import { expectTypeOf, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

it("retains each RPC handler's required services in the layer", () => {
  class First extends Context.Service<First, { readonly value: string }>()(
    "t3/testUtils/rpcHandlerServices.test/First",
  ) {}
  class Second extends Context.Service<Second, { readonly value: string }>()(
    "t3/testUtils/rpcHandlerServices.test/Second",
  ) {}
  const group = RpcGroup.make(Rpc.make("first"), Rpc.make("second"), Rpc.make("independent"));
  const layer = group.toLayer({
    first: () => Effect.asVoid(First),
    second: () => Effect.asVoid(Second),
    independent: () => Effect.void,
  });
  expectTypeOf<Layer.Services<typeof layer>>().toEqualTypeOf<First | Second>();
});
