import { ApiError } from "../api";
import { foodLabel, passwordProblem, setQty, slotLabel, staffLoginMessage } from "../team-logic";

describe("store team helpers", () => {
  it("explains a locked account with the minutes left", () => {
    expect(staffLoginMessage(new ApiError(423, "account_locked", { retryAfterSeconds: 61 }))).toContain("2 minutes");
    expect(staffLoginMessage(new ApiError(403, "account_inactive"))).toContain("switched off");
  });

  it("applies the API's password rule", () => {
    expect(passwordProblem("short")).toBe("password_too_short");
    expect(passwordProblem("12345678")).toBe("password_only_digits");
    expect(passwordProblem("shelf-and-aisle-7")).toBeNull();
  });

  it("never guesses a food label", () => {
    expect(foodLabel(null).text).toBe("Not labelled");
    expect(foodLabel("egg")).toEqual({ text: "Egg", dot: "#7C2D12" });
    expect(foodLabel("veg").dot).toBe("#15803D");
  });

  it("shows pickup slots in India time", () => {
    expect(slotLabel("2026-10-23T12:30:00Z", "2026-10-23T13:00:00Z")).toBe("Fri 18:00–18:30");
  });

  it("caps and clears basket quantities", () => {
    expect(setQty({}, "p1", 25)).toEqual({ p1: 20 });
    expect(setQty({ p1: 2 }, "p1", 0)).toEqual({});
  });
});
