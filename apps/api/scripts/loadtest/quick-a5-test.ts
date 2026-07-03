import { SignJWT } from "jose";

const BASE = process.env.API_URL || "http://localhost:3000";
const rawSecret = process.env.JWT_SECRET!;
const JWT_SECRET = new TextEncoder().encode(rawSecret);

async function main() {
  const token = await new SignJWT({
    userId: "00000000-0000-0000-0000-000000000001",
    tenantId: "'; DROP TABLE users; --",
    sectorId: null,
    roles: ["ORG_ADMIN"],
  })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt()
    .setIssuer("docid-api").setAudience("docid-desktop")
    .setExpirationTime("5m")
    .sign(JWT_SECRET);

  const res = await fetch(`${BASE}/identifiers`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log("Status:", res.status);
  console.log("Content-Type:", res.headers.get("content-type"));
  console.log("Body:", await res.text());
}

main().catch(console.error);
