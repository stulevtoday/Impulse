export interface User {
  id: string;
  name: string;
  email: string;
}

export interface Post {
  id: string;
  title: string;
  authorId: string;
}

export type Theme = "light" | "dark";
