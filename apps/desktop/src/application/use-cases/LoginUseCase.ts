import type { IApiClient } from "../ports/IApiClient";
import type { ISyncService } from "../ports/ISyncService";
import type { IAuthRepository } from "../../domain/repositories/IAuthRepository";

interface LoginRequest { email: string; password: string; }
interface LoginResponse { data: { token: string; user: import("../../domain/entities/User").StoredUser; }; }

export class LoginUseCase {
  constructor(private readonly api: IApiClient, private readonly sync: ISyncService, private readonly authRepo: IAuthRepository) {}
  async execute(credentials: LoginRequest): Promise<LoginResponse> {
    const res = await this.api.post<LoginResponse>("/auth/login", credentials);
    this.authRepo.setSession(res.data.token, res.data.user);
    await this.sync.setCredentials(res.data.token);
    return res;
  }
}
