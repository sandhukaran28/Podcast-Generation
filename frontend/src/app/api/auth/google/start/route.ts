export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { randomBytes, createHash } from "crypto";

const b64url = (buf: Buffer) =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/,"");

export async function GET() {
  const domain = process.env.NEXT_PUBLIC_COGNITO_DOMAIN;   // e.g. https://xyz.auth.ap-southeast-2.amazoncognito.com
  const clientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID;
  const redirectUri = process.env.NEXT_PUBLIC_REDIRECT_URI; // e.g. http://localhost:3000/api/auth/google/callback

  if (!domain || !clientId || !redirectUri) {
    console.error("Missing env", { domain, clientId, redirectUri });
    return NextResponse.json({ error: "Missing Cognito env vars" }, { status: 500 });
  }

  // PKCE: state + verifier + challenge
  const state = b64url(randomBytes(16));
  const verifier = b64url(randomBytes(64));
  const challenge = b64url(createHash("sha256").update(verifier).digest());

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    scope: "openid email profile",
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    identity_provider: "Google",
  });

  const authorize = `${domain.replace(/\/$/, "")}/oauth2/authorize?${params.toString()}`;

  const res = NextResponse.redirect(authorize);
    console.log("AUTHZ ->", `${domain.replace(/\/$/,"")}/oauth2/authorize?${params.toString()}`);
console.log("SET COOKIES for host of your app. redirect_uri =", redirectUri);
  res.cookies.set("pkce_verifier", verifier, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 300 });
  res.cookies.set("oauth_state", state, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 300 });

  return res;
}
