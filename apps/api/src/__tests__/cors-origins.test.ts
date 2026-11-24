import { describe, it, expect } from "bun:test";
import Elysia from "elysia";
import { cors } from "@elysiajs/cors";
import { ALLOWED_ORIGINS } from "../lib/cors";

const app = new (Elysia as any)()
  .use(cors({ origin: ALLOWED_ORIGINS, credentials: true }))
  .post("/auth/login", () => ({ ok: true }));

async function preflight(origin: string) {
  const res = await app.handle(new Request("http://api/auth/login", {
    method: "OPTIONS",
    headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" },
  }));
  return res.headers.get("access-control-allow-origin");
}

describe("CORS da app desktop", () => {
  it("aceita a origem do Windows (http://tauri.localhost)", async () => {
    expect(await preflight("http://tauri.localhost")).toBe("http://tauri.localhost");
  });
  it("aceita macOS/Linux e Windows com https", async () => {
    expect(await preflight("tauri://localhost")).toBe("tauri://localhost");
    expect(await preflight("https://tauri.localhost")).toBe("https://tauri.localhost");
  });
  it("recusa origens desconhecidas", async () => {
    expect(await preflight("https://site-malicioso.example")).toBeNull();
  });
});
