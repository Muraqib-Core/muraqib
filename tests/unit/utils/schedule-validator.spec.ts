import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isWithinSchedule } from "../../../src/utils/schedule-validator.js";

describe("isWithinSchedule", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("always runs for missing, empty or blank schedules", () => {
    expect(isWithinSchedule()).toBe(true);
    expect(isWithinSchedule("")).toBe(true);
    expect(isWithinSchedule("   ")).toBe(true);
  });

  it("runs 'on weekends' only on Friday, Saturday and Sunday", () => {
    // 2026-01-05 is a Monday
    const expected: Array<[string, boolean]> = [
      ["2026-01-05T12:00:00", false],
      ["2026-01-06T12:00:00", false],
      ["2026-01-07T12:00:00", false],
      ["2026-01-08T12:00:00", false],
      ["2026-01-09T12:00:00", true],
      ["2026-01-10T12:00:00", true],
      ["2026-01-11T12:00:00", true],
    ];
    for (const [date, result] of expected) {
      vi.setSystemTime(new Date(date));
      expect(isWithinSchedule("On Weekends")).toBe(result);
    }
  });

  it("runs when the last cron occurrence was within the past hour", () => {
    vi.setSystemTime(new Date("2026-01-05T12:30:00"));
    expect(isWithinSchedule("0 * * * *")).toBe(true);
  });

  it("does not run when the last cron occurrence is older than an hour", () => {
    vi.setSystemTime(new Date("2026-01-05T12:30:00"));
    expect(isWithinSchedule("0 3 * * *")).toBe(false);
  });
});
