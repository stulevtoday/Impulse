import type { User } from "./types.js";
import { formatUserName } from "./utils/format.js";

export function getUser(id: string): User {
  return { id, name: "Test", email: "test@example.com" };
}

export function displayUser(id: string): string {
  const user = getUser(id);
  return formatUserName(user);
}
