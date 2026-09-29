import { describe, expect, it } from "vitest";
import { resolveColorScheme } from "../src/frontend/useColorScheme";

describe("resolveColorScheme", () => {
  it("follows the OS for system-preferred or missing themes", () => {
    expect(resolveColorScheme("SYSTEM_PREFERRED", true)).toBe("dark");
    expect(resolveColorScheme("SYSTEM_PREFERRED", false)).toBe("light");
    expect(resolveColorScheme(null, true)).toBe("dark");
  });
  it("honours explicit themes regardless of the OS", () => {
    expect(resolveColorScheme("light", true)).toBe("light");
    expect(resolveColorScheme("dark", false)).toBe("dark");
    expect(resolveColorScheme("high-contrast-dark", false)).toBe("dark");
    expect(resolveColorScheme("high-contrast-light", true)).toBe("light");
  });
});
