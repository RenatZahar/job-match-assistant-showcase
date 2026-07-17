import { describe, expect, it } from "vitest";

import { normalizeApiBaseUrl, normalizeMatchApiMode } from "./env";

describe("normalizeApiBaseUrl", () => {
  it("removes trailing slashes", () => {
    expect(normalizeApiBaseUrl("https://api.example.com///")).toBe("https://api.example.com");
  });

  it("falls back to localhost backend when value is empty", () => {
    expect(normalizeApiBaseUrl("")).toBe("http://localhost:8000");
  });
});

describe("normalizeMatchApiMode", () => {
  it("uses mock mode by default", () => {
    expect(normalizeMatchApiMode(undefined)).toBe("mock");
    expect(normalizeMatchApiMode("")).toBe("mock");
  });

  it("uses api mode only when explicitly configured", () => {
    expect(normalizeMatchApiMode("api")).toBe("api");
    expect(normalizeMatchApiMode("mock")).toBe("mock");
    expect(normalizeMatchApiMode("unexpected")).toBe("mock");
  });
});
