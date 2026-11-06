export interface User {
  id: string;
  name: string;
  email: string;
  teamId: string;
}

const users: User[] = [
  { id: "u1", name: "Ada Lovelace", email: "ada@teamdesk.dev", teamId: "t1" },
  { id: "u2", name: "Grace Hopper", email: "grace@teamdesk.dev", teamId: "t1" },
  { id: "u3", name: "Linus Torvalds", email: "linus@teamdesk.dev", teamId: "t2" },
];

export async function getUser(id: string): Promise<User | undefined> {
  return users.find((u) => u.id === id);
}

export async function listUsers(teamId: string): Promise<User[]> {
  return users.filter((u) => u.teamId === teamId);
}

export function formatUser(u: User): string {
  return `${u.name} <${u.email}>`;
}
