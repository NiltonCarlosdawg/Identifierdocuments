import type { IApiClient } from "../ports/IApiClient";
import type { IAuthRepository } from "../../domain/repositories/IAuthRepository";
import type { StoredUser } from "../../domain/entities/User";

interface RefreshResponse { data: { token: string; user: StoredUser; }; }

export class RefreshTokenUseCase {
  constructor(private readonly api: IApiClient, private readonly authRepo: IAuthRepository) {}
  async execute(): Promise<boolean> {
    const currentToken = this.authRepo.getToken();
    if (!currentToken) return false;
    try {
      const res = await this.api.post<RefreshResponse>("/auth/refresh", { token: currentToken });
      if (res.data?.token) { this.authRepo.setSession(res.data.token, res.data.user); return true; }
      return false;
    } catch { return false; }
  }
}
