/**
 * Origens autorizadas a chamar a API (CORS).
 *
 * O Tauri 2 usa origens diferentes consoante o sistema:
 * - Windows (e Android): `http://tauri.localhost` por defeito (`useHttpsScheme: false`);
 *   `https://tauri.localhost` só se `useHttpsScheme: true`.
 * - macOS / Linux: `tauri://localhost`.
 * Faltava a origem do Windows, por isso o login falhava na app instalada no Windows.
 */
export const ALLOWED_ORIGINS = [
  "http://localhost:1420", // vite dev
  "http://127.0.0.1:1420",
  "http://tauri.localhost", // Windows (defeito do Tauri 2)
  "https://tauri.localhost", // Windows com useHttpsScheme
  "tauri://localhost", // macOS / Linux
  // Painel admin/landing (docid.milvendas.ao) em produção.
  ...(process.env.ADMIN_ORIGIN ? [process.env.ADMIN_ORIGIN] : []),
  // Origens do frontend em modo browser (dev/e2e); em produção não são aceites.
  ...(process.env.NODE_ENV === "production" ? [] : [
    "http://localhost:4173", "http://127.0.0.1:4173",
    "http://localhost:5173", "http://127.0.0.1:5173",
    "http://localhost:5174", "http://127.0.0.1:5174",
    "http://localhost:4174", "http://127.0.0.1:4174", // landing nos testes E2E
  ]),
];
