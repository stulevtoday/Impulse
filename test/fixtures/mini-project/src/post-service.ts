import type { Post } from "./types.js";

export function getPost(id: string): Post {
  return { id, title: "Hello", authorId: "1" };
}
