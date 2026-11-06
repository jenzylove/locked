import { formatUser, getUser } from "../users/users.js";

export interface ProfileView {
  title: string;
  displayName: string;
  teamId: string;
}

export async function buildProfile(userId: string): Promise<ProfileView | undefined> {
  const user = await getUser(userId);
  if (!user) return undefined;
  return { title: user.name, displayName: formatUser(user), teamId: user.teamId };
}
