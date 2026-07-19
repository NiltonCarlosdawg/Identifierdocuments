import { HttpApiClient } from "../api/HttpApiClient";
import { TauriSyncAdapter } from "../sync/TauriSyncAdapter";
import { TauriScannerAdapter } from "../scanner/TauriScannerAdapter";
import type { IAuthRepository } from "../../domain/repositories/IAuthRepository";
import type { StoredUser } from "../../domain/entities/User";
import { useAuthStore } from "../../interfaces/stores/authStore";
import { useAppConfigStore } from "../../interfaces/stores/configStore";

const authRepo: IAuthRepository = {
  getToken: () => useAuthStore.getState().token,
  getUser: () => useAuthStore.getState().user,
  setSession: (token: string, user: StoredUser) => useAuthStore.getState().login(token, user),
  setUser: (user: StoredUser) => useAuthStore.getState().setUser(user),
  clearSession: () => useAuthStore.getState().logout(),
};

const getBaseUrl = () => useAppConfigStore.getState().apiBaseUrl;

export const api = new HttpApiClient(authRepo, getBaseUrl);
export const sync = new TauriSyncAdapter();
export const scanner = new TauriScannerAdapter();
