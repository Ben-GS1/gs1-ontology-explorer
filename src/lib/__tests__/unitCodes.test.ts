import { describe, expect, it } from "vitest";
import { describeUnitCode } from "@/lib/unitCodes";

describe("describeUnitCode", () => {
  it("appends a human-readable label for a known UN/CEFACT code", () => {
    expect(describeUnitCode("KMH")).toBe("KMH (kilometre per hour)");
    expect(describeUnitCode("TNE")).toBe("TNE (tonne)");
  });

  it("is case-insensitive when looking up the label but preserves the original code casing in the output", () => {
    expect(describeUnitCode("kmh")).toBe("kmh (kilometre per hour)");
  });

  it("returns the code unchanged when it isn't a recognised unit", () => {
    expect(describeUnitCode("XYZ_NOT_A_REAL_UNIT")).toBe("XYZ_NOT_A_REAL_UNIT");
  });
});
