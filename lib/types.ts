export type Role = "admin" | "uploader" | "reader";

export type SessionInfo = {
  email: string;
  displayName: string;
  role: Role;
};

export type Category = {
  id: number;
  parent_id: number | null;
  name: string;
  icon: string;
  sort_order: number;
};
