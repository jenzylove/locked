import { describe, expect, it } from "vitest";
import { addMember, getTeam, listTeams } from "../src/teams/teams.js";

describe("teams", () => {
  it("lists teams", async () => {
    expect((await listTeams()).length).toBe(2);
  });

  it("gets a team", async () => {
    expect((await getTeam("t2"))?.name).toBe("Kernel");
  });

  it("adds a member", async () => {
    const team = await addMember("t2", "u1");
    expect(team.memberIds).toContain("u1");
  });

  it("rejects an unknown user", async () => {
    await expect(addMember("t1", "ghost")).rejects.toThrow("User not found");
  });
});
