import type * as Effect from "effect/Effect";
import { goal } from "./goals.ts";

export const start = <A, E, R>(launch: (goal: string) => Effect.Effect<A, E, R>) => launch(goal);
