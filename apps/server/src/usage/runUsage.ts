import type { ExecutionCost, ModelSelection, TurnTokenUsage } from "@t3tools/contracts";
import { priceUsage, type RateTable } from "./usagePricing.ts";

export interface RunUsage {
  readonly complete: boolean;
  readonly samples: readonly {
    readonly id: string;
    readonly selection: ModelSelection;
    readonly usage: TurnTokenUsage | undefined;
  }[];
}

export function priceRunUsage(
  input: RunUsage,
  rates: RateTable,
  overrides: RateTable,
  aliases: ReadonlyMap<string, string>,
): ExecutionCost {
  let complete = input.complete;
  let usd = 0;
  let priced = 0;
  const seen = new Set<string>();
  for (const sample of input.samples) {
    if (seen.has(sample.id)) continue;
    seen.add(sample.id);
    const usage = sample.usage;
    if (
      !usage ||
      usage.usageStatus === "unavailable" ||
      usage.inputTokens === undefined ||
      usage.outputTokens === undefined
    ) {
      complete = false;
      continue;
    }
    const cached = usage.cachedInputTokens ?? 0;
    const created = usage.cacheCreationTokens ?? 0;
    if (cached + created > usage.inputTokens) {
      complete = false;
      continue;
    }
    const tier = sample.selection.options?.find((option) => option.id === "serviceTier")?.value;
    const fast = sample.selection.options?.some(
      (option) => option.id === "fastMode" && option.value === true,
    );
    const model = aliases.get(sample.selection.model) ?? sample.selection.model;
    const result = priceUsage(
      rates,
      {
        model,
        totals: {
          uncachedInputTokens: usage.inputTokens - cached - created,
          cachedInputTokens: cached,
          cacheCreationTokens: created,
          outputTokens: usage.outputTokens,
          reasoningTokens: usage.reasoningTokens ?? 0,
        },
        speed:
          tier === "ultrafast"
            ? "ultrafast"
            : fast || tier === "fast" || tier === "priority"
              ? "fast"
              : "standard",
        reportedCostUsd: null,
      },
      overrides,
    );
    if (result.costSource === "unpriced") {
      complete = false;
      continue;
    }
    usd += result.costUsd;
    priced++;
    if (usage.usageStatus !== "complete") complete = false;
  }
  return {
    usd: priced || (complete && input.samples.length === 0) ? usd : null,
    coverage: complete ? "complete" : priced ? "partial" : "unavailable",
  };
}
