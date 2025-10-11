"use client";
export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/hooks/useAuth";
import { useRouter } from "next/navigation";

// ...imports unchanged...
type Mode = "login" | "register" | "confirm" | "mfa";

export default function AuthPage() {
  const { login, register, confirm, resendCode, completeMfa, ready, token } =
    useAuth();
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  // NEW: keep the pending MFA context
  const [mfaPending, setMfaPending] = useState<
    import("@/hooks/useAuth").MfaPending | null
  >(null);

  const title = useMemo(() => {
    switch (mode) {
      case "register":
        return "Create account";
      case "confirm":
        return "Confirm your email";
      case "mfa":
        return "Verify it’s you";
      default:
        return "Sign in";
    }
  }, [mode]);

  const subtitle = useMemo(() => {
    switch (mode) {
      case "register":
        return "Sign up with your email & password";
      case "confirm":
        return "Enter the verification code sent to your email";
      case "mfa":
        return "We’ve sent a one-time code to your email";
      default:
        return "Enter your credentials";
    }
  }, [mode]);

  useEffect(() => {
    if (ready && token) {
      router.replace("/");
    }
  }, [ready, token, router]);

  const clearAlerts = () => {
    setErr("");
    setMsg("");
  };

  const handleLogin = async () => {
    clearAlerts();
    setBusy(true);
    try {
      const res = await login(email, password);
      // If MFA required, show the MFA step instead of redirecting
      if (res && (res as any).mfaRequired) {
        setMfaPending(res as any);
        setMode("mfa");
        setMsg("Enter the 6-digit code we emailed you.");
        return; // stop here; don't redirect yet
      }
      router.push("/");
    } catch (e: any) {
      // Nice DX: if they never confirmed, jump them to confirm screen
      if (e?.code === "UserNotConfirmedException") {
        setMode("confirm");
        setMsg("Please confirm your email to continue.");
      } else {
        setErr(e?.message ?? "Failed to sign in");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRegister = async () => {
    clearAlerts();
    setBusy(true);
    try {
      await register(email, password, email);
      setMsg("Account created. Check your email for the confirmation code.");
      setMode("confirm");
    } catch (e: any) {
      setErr(e?.message ?? "Failed to sign up");
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async () => {
    clearAlerts();
    setBusy(true);
    try {
      await confirm(email, code);
      setMsg("Email confirmed. You can now sign in.");
      setMode("login");
    } catch (e: any) {
      setErr(e?.message ?? "Failed to confirm code");
    } finally {
      setBusy(false);
    }
  };

  // ⬇️ NEW: complete the MFA step
  const handleMfa = async () => {
    if (!mfaPending) return;
    clearAlerts();
    setBusy(true);
    try {
      await completeMfa(mfaPending, code.trim());
      router.push("/");
    } catch (e: any) {
      setErr(e?.message ?? "Invalid or expired code");
    } finally {
      setBusy(false);
    }
  };

  // Optional: if user didn’t get the MFA code, re-trigger step 1 (sign-in),
  // which makes Cognito send a fresh email OTP.
  const handleResendMfa = async () => {
    clearAlerts();
    if (!email || !password) {
      setErr("Enter your email and password first.");
      return;
    }
    setBusy(true);
    try {
      const res = await login(email, password);
      if (res && (res as any).mfaRequired) {
        setMfaPending(res as any);
        setMsg("Code re-sent. Check your inbox.");
      } else {
        // Edge: user might have completed MFA on another device; just redirect
        router.push("/");
      }
    } catch (e: any) {
      setErr(e?.message ?? "Couldn’t resend code");
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "login") return handleLogin();
    if (mode === "register") return handleRegister();
    if (mode === "confirm") return handleConfirm();
    if (mode === "mfa") return handleMfa();
  };

  if (!ready || token) {
    return (
      <div className="min-h-dvh grid place-items-center p-6 text-sm text-gray-600">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-dvh grid place-items-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader title={title} subtitle={subtitle} />
        <CardBody>
          <form onSubmit={onSubmit} className="grid gap-3">
            {/* Always show email */}
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            {/* Password on login/register (not on MFA or confirm) */}
            {(mode === "login" || mode === "register") && (
              <Input
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            )}

            {/* Confirm-email code */}
            {mode === "confirm" && (
              <Input
                label="Confirmation code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
            )}

            {/* ⬇️ NEW: MFA code */}
            {mode === "mfa" && (
              <Input
                label="One-time code"
                inputMode="numeric"
                pattern="[0-9]*"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
            )}

            {err && <p className="text-sm text-red-600">{err}</p>}
            {msg && <p className="text-sm text-green-700">{msg}</p>}

            <Button type="submit" disabled={busy}>
              {busy
                ? mode === "login"
                  ? "Signing in…"
                  : mode === "register"
                  ? "Creating account…"
                  : mode === "confirm"
                  ? "Confirming…"
                  : "Verifying…"
                : mode === "login"
                ? "Sign in"
                : mode === "register"
                ? "Create account"
                : mode === "confirm"
                ? "Confirm"
                : "Verify"}
            </Button>
          </form>
          <div className="flex justify-center my-2">
            {" "}
            <span className=" text-center text-sm text-gray-500 w-full">
              or
            </span>
          </div>

          <a href="/api/auth/google/start">
            <Button className="w-full ">Continue with Google</Button>
          </a>

          {/* Footer actions */}
          <div className="mt-4 grid gap-2 text-sm">
            {mode !== "login" && (
              <button
                type="button"
                className="text-gray-600 hover:underline text-left"
                onClick={() => {
                  clearAlerts();
                  setMode("login");
                }}
                disabled={busy}
              >
                ← Back to Sign in
              </button>
            )}

            {mode === "login" && (
              <button
                type="button"
                className="text-gray-600 hover:underline text-left"
                onClick={() => {
                  clearAlerts();
                  setMode("register");
                }}
                disabled={busy}
              >
                Don’t have an account? Create one
              </button>
            )}

            {mode === "register" && (
              <button
                type="button"
                className="text-gray-600 hover:underline text-left"
                onClick={() => {
                  clearAlerts();
                  setMode("confirm");
                }}
                disabled={busy}
              >
                Already registered? Enter confirmation code
              </button>
            )}

            {mode === "confirm" && (
              <button
                type="button"
                className="text-gray-600 hover:underline text-left"
                onClick={() => resendCode(email)}
                disabled={busy || !email}
                title={!email ? "Enter your email above first" : ""}
              >
                Resend confirmation code
              </button>
            )}

            {mode === "mfa" && (
              <button
                type="button"
                className="text-gray-600 hover:underline text-left"
                onClick={handleResendMfa}
                disabled={busy || !email || !password}
                title={
                  !email || !password
                    ? "Enter your email & password above first"
                    : ""
                }
              >
                Didn’t get the code? Resend
              </button>
            )}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
