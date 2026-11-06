import { describe, expect, it } from "vitest";
import { formatUser, getUser, listUsers } from "../src/users/users.js";

describe("users", () => {
  it("gets a user by id", async () => {
    expect((await getUser("u1"))?.name).toBe("Ada Lovelace");
  });

  it("returns undefined for an unknown user", async () => {
    expect(await getUser("nope")).toBeUndefined();
  });

  it("lists users for a team", async () => {
    const users = await listUsers("t1");
    expect(users.map((u) => u.id)).toEqual(["u1", "u2"]);
  });

  it("formats a user", async () => {
    const u = await getUser("u2");
    expect(formatUser(u!)).toBe("Grace Hopper <grace@teamdesk.dev>");
  });
});
