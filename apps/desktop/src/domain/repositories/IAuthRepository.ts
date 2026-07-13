import type { StoredUser } from "../entities/User";

export interface IAuthRepository {
  getToken(): string | null;
  getUser(): StoredUser | null;
  setSession(token: string, user: StoredUser): void;
  setUser(user: StoredUser): void;
  clearSession(): void;
}
