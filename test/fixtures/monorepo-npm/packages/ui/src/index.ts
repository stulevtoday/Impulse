import { greet } from "@test/core";

export function render(name: string): string {
  return `<div>${greet(name)}</div>`;
}
