import { addMember, getTeam, listTeams } from "../teams/teams.js";
import { getUser, listUsers } from "../users/users.js";
import { buildProfile } from "../pages/profile.js";
import { buildTeamPage } from "../pages/team.js";

export interface Response {
  status: number;
  body: unknown;
}

export type Handler = (params: Record<string, string>) => Promise<Response>;

const ok = (body: unknown): Response => ({ status: 200, body });
const notFound = (): Response => ({ status: 404, body: { error: "not found" } });

export const routes: Record<string, Handler> = {
  "GET /users/:id": async ({ id }) => {
    const user = await getUser(id);
    return user ? ok(user) : notFound();
  },
  "GET /teams": async () => ok(await listTeams()),
  "GET /teams/:id": async ({ id }) => {
    const team = await getTeam(id);
    return team ? ok(team) : notFound();
  },
  "GET /teams/:id/users": async ({ id }) => ok(await listUsers(id)),
  "POST /teams/:id/members/:userId": async ({ id, userId }) => {
    try {
      return ok(await addMember(id, userId));
    } catch {
      return notFound();
    }
  },
  "GET /pages/profile/:id": async ({ id }) => {
    const view = await buildProfile(id);
    return view ? ok(view) : notFound();
  },
  "GET /pages/team/:id": async ({ id }) => {
    const view = await buildTeamPage(id);
    return view ? ok(view) : notFound();
  },
};

export async function dispatch(method: string, path: string): Promise<Response> {
  const segments = path.split("/").filter(Boolean);
  for (const [pattern, handler] of Object.entries(routes)) {
    const [m, p] = pattern.split(" ");
    const parts = p.split("/").filter(Boolean);
    if (m !== method || parts.length !== segments.length) continue;
    const params: Record<string, string> = {};
    const matches = parts.every((part, i) => {
      if (part.startsWith(":")) {
        params[part.slice(1)] = segments[i];
        return true;
      }
      return part === segments[i];
    });
    if (matches) return handler(params);
  }
  return notFound();
}
