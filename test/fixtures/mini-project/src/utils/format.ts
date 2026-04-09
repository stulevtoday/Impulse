import type { User } from "../types.js";

export function formatUserName(user: User): string {
  return `${user.name} <${user.email}>`;
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
