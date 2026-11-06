import { describe, expect, it } from "vitest";
import { buildProfile } from "../src/pages/profile.js";
import { buildTeamPage } from "../src/pages/team.js";
import { dispatch } from "../src/routes/index.js";

describe("pages and routes", () => {
  it("builds a profile view", async () => {
    const view = await buildProfile("u3");
    expect(view?.displayName).toBe("Linus Torvalds <linus@teamdesk.dev>");
  });

  it("builds a team page", async () => {
    const view = await buildTeamPage("t1");
    expect(view?.memberCount).toBe(2);
  });

  it("routes GET /users/:id", async () => {
    const res = await dispatch("GET", "/users/u1");
    expect(res.status).toBe(200);
  });

  it("returns 404 for unknown routes", async () => {
    expect((await dispatch("GET", "/nothing")).status).toBe(404);
  });
});
