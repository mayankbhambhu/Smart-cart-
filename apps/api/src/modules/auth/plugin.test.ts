import { describe, expect, it } from "vitest";
import { bearerToken } from "./plugin.js";
import { DevTokenVerifier } from "./verifier.js";

describe("bearer tokens", () => {
  it("keeps everything after the scheme, including spaces", () => {
    expect(bearerToken("Bearer dev:asha:Asha Patil")).toBe("dev:asha:Asha Patil");
    expect(bearerToken("bearer abc.def")).toBe("abc.def");
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });

  it("reads uid and display name from a dev token", async () => {
    await expect(new DevTokenVerifier().verify("dev:asha:Asha Patil")).resolves.toEqual({
      uid: "asha",
      name: "Asha Patil",
    });
    await expect(new DevTokenVerifier().verify("eyJhbGciOi...")).rejects.toThrow();
  });
});
