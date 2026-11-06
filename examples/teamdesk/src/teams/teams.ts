import { getUser } from "../users/users.js";

export interface Team {
  id: string;
  name: string;
  memberIds: string[];
}

const teams: Team[] = [
  { id: "t1", name: "Platform", memberIds: ["u1", "u2"] },
  { id: "t2", name: "Kernel", memberIds: ["u3"] },
];

export async function getTeam(id: string): Promise<Team | undefined> {
  return teams.find((t) => t.id === id);
}

export async function listTeams(): Promise<Team[]> {
  return [...teams];
}

export async function addMember(teamId: string, userId: string): Promise<Team> {
  const team = await getTeam(teamId);
  if (!team) throw new Error(`Team not found: ${teamId}`);
  const user = await getUser(userId);
  if (!user) throw new Error(`User not found: ${userId}`);
  if (!team.memberIds.includes(user.id)) team.memberIds.push(user.id);
  return team;
}
