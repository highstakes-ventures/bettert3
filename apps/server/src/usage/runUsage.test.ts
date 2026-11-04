import { describe, expect, it } from "@effect/vitest";
import { ProviderInstanceId, type TurnTokenUsage } from "@t3tools/contracts";
import { parseRateTable, createOverrideRateTable } from "./usagePricing.ts";
import { priceRunUsage, type RunUsage } from "./runUsage.ts";

const rates = parseRateTable({
  known: {
    input_cost_per_token: 0.000002,
    output_cost_per_token: 0.000008,
    cache_read_input_token_cost: 0.0000005,
    cache_creation_input_token_cost: 0.000003,
  },
});
const usage: TurnTokenUsage = {
  usageScope: "main_agent",
  usageStatus: "complete",
  inputTokens: 1000,
  cachedInputTokens: 400,
  cacheCreationTokens: 100,
  outputTokens: 200,
  reasoningTokens: 100,
  hasSubagents: false,
};
const sample = (id: string, model = "known") => ({
  id,
  selection: { instanceId: ProviderInstanceId.make("codex"), model },
  usage,
});
const price = (samples: RunUsage["samples"], complete = true) =>
  priceRunUsage({ samples, complete }, rates, new Map(), new Map());

describe("execution cost", () => {
  it("counts each exact turn once, separates cached tokens, and does not charge reasoning twice", () => {
    const result = price([sample("parent"), sample("parent"), sample("retry"), sample("child")]);
    expect(result.coverage).toBe("complete");
    expect(result.usd).toBeCloseTo(0.0093);
  });
  it("keeps known costs when metering, model prices or child coverage are missing", () => {
    expect(price([sample("known"), sample("unknown", "no-rate")]).coverage).toBe("partial");
    expect(price([sample("known"), sample("unknown", "no-rate")]).usd).toBeCloseTo(0.0031);
    expect(price([sample("unknown", "no-rate")])).toEqual({ coverage: "unavailable", usd: null });
    expect(price([{ ...sample("missing"), usage: undefined }])).toEqual({
      coverage: "unavailable",
      usd: null,
    });
    expect(price([sample("main")], false).coverage).toBe("partial");
    expect(price([], false)).toEqual({ coverage: "unavailable", usd: null });
    expect(price([])).toEqual({ coverage: "complete", usd: 0 });
  });
  it("applies the same model aliases and custom prices as usage totals", () => {
    const overrides = createOverrideRateTable({
      known: { inputCostPerMillionTokens: 1, outputCostPerMillionTokens: 2 },
    });
    expect(
      priceRunUsage(
        { samples: [sample("turn", "alias")], complete: true },
        rates,
        overrides,
        new Map([["alias", "known"]]),
      ),
    ).toEqual({ coverage: "complete", usd: 0.0014 });
  });
  it("does not price inconsistent cache totals as complete", () => {
    expect(price([{ ...sample("bad"), usage: { ...usage, cachedInputTokens: 1001 } }])).toEqual({
      coverage: "unavailable",
      usd: null,
    });
  });
});
