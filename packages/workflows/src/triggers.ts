import * as DateTime from "effect/DateTime";
export const scannerTriggers = [
  {
    workflow: "performance",
    timeOfDay: "07:00",
    timeZone: "Europe/Amsterdam",
    enabledByDefault: false,
  },
  {
    workflow: "refactor",
    timeOfDay: "07:00",
    timeZone: "Europe/Amsterdam",
    enabledByDefault: false,
  },
] as const;

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Amsterdam",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});
const parts = (epoch: number) =>
  Object.fromEntries(formatter.formatToParts(epoch).map((part) => [part.type, part.value]));

/** Latest due local date, with no backlog of older missed days. Activation never backfills. */
export function dueScannerDate(now: number, enabledAt: number): string | null {
  const local = parts(now);
  const today = `${local.year}-${local.month}-${local.day}`;
  const key =
    Number(local.hour) >= 7
      ? today
      : DateTime.formatIsoDate(
          DateTime.subtract(DateTime.makeUnsafe(`${today}T12:00:00Z`), { days: 1 }),
        );
  const activation = parts(enabledAt);
  const activationDay = `${activation.year}-${activation.month}-${activation.day}`;
  return key > activationDay || (key === activationDay && Number(activation.hour) < 7) ? key : null;
}
