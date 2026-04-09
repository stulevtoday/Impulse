import { displayUser } from "./user-service.js";
import { getPost } from "./post-service.js";

export function main(): void {
  console.log(displayUser("1"));
  console.log(getPost("1"));
}
