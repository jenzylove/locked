import { getTeam } from "../teams/teams.js";
import { formatUser, listUsers } from "../users/users.js";

export interface TeamView {
  name: string;
  memberCount: number;
  members: string[];
}

export async function buildTeamPage(teamId: string): Promise<TeamView | undefined> {
  const team = await getTeam(teamId);
  if (!team) return undefined;
  const users = await listUsers(teamId);
  return { name: team.name, memberCount: users.length, members: users.map(formatUser) };
}
