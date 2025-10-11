export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

const COGNITO_DOMAIN   = process.env.NEXT_PUBLIC_COGNITO_DOMAIN!;   // e.g. https://<your-domain>.auth.<region>.amazoncognito.com
const CLIENT_ID        = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID!;
const REDIRECT_URI     = process.env.NEXT_PUBLIC_REDIRECT_URI!;      // http://localhost:3000/api/auth/google/callback

export async function GET(req: NextRequest) {
  const url   = new URL(req.url);
  const code  = url.searchParams.get("code");
  const err   = url.searchParams.get("error");
  const state = url.searchParams.get("state");

  // Provider error? Bubble it to the UI.
  if (err) {
    const desc = url.searchParams.get("error_description") || "";
    return NextResponse.redirect(new URL(`/?auth=${encodeURIComponent(err)}&reason=${encodeURIComponent(desc)}`, req.url));
  }

  // Validate state and PKCE
  const savedState = req.cookies.get("oauth_state")?.value;
  const verifier   = req.cookies.get("pkce_verifier")?.value;

  if (!code || !state || !savedState || state !== savedState || !verifier) {
    return NextResponse.redirect(new URL("/?auth=invalid_state", req.url));
  }

  // Exchange code -> tokens at Cognito
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    code,
    code_verifier: verifier,
    redirect_uri: REDIRECT_URI,
  });

  let tokenRes: Response;
  try {
    tokenRes = await fetch(`${COGNITO_DOMAIN.replace(/\/$/, "")}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch {
    return NextResponse.redirect(new URL("/?auth=network_error", req.url));
  }

  if (!tokenRes.ok) {
    const txt = await tokenRes.text().catch(() => "");
    return NextResponse.redirect(new URL(`/?auth=token_exchange_failed&detail=${encodeURIComponent(txt.slice(0,200))}`, req.url));
  }

  const { id_token, access_token, refresh_token, expires_in } = await tokenRes.json();

  // Minimal decode of id_token to get username + exp
  const payload = JSON.parse(Buffer.from(id_token.split(".")[1], "base64").toString("utf8"));
  const username = payload.email || payload["cognito:username"] || payload.sub || "user";
  const exp = payload.exp ?? (Math.floor(Date.now()/1000) + (expires_in || 3600));

  // Build a tiny HTML page that transfers tokens to localStorage, calls /api/session, then redirects.
  const data = {
    idToken: id_token,
    accessToken: access_token,
    refreshToken: refresh_token,
    username,
    exp,
  };
  const html = `<!doctype html>
<meta charset="utf-8">
<script>
  try {
    const data = ${JSON.stringify(data)};
    localStorage.setItem('nf_auth', JSON.stringify(data));
    // (Optional) create server session if your backend expects it:
    fetch('/api/session', {
      method: 'POST',
      headers: {'content-type':'application/json'},
      body: JSON.stringify({ idToken: data.idToken })
    }).catch(()=>{});
  } finally {
    // Redirect to your dashboard/home
    window.location.replace('/');
  }
</script>`;

  const res = new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  // Clear temp cookies
  res.cookies.set("pkce_verifier", "", { path: "/", maxAge: 0 });
  res.cookies.set("oauth_state",   "", { path: "/", maxAge: 0 });
  return res;
}
