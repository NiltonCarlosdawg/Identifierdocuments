export class AppError extends Error {
  constructor(message: string, public readonly statusCode?: number, public readonly code?: string) {
    super(message);
    this.name = "AppError";
  }
}

export class AuthError extends AppError {
  constructor(message = "Não autenticado") { super(message, 401, "UNAUTHORIZED"); this.name = "AuthError"; }
}

export class NetworkError extends AppError {
  constructor(message = "Erro de rede") { super(message, undefined, "NETWORK_ERROR"); this.name = "NetworkError"; }
}
