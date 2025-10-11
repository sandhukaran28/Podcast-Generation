// src/hooks/useAuth.ts
'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import {
  cognitoLogin,
  getCurrentUser,
  signOut,
  signUp as poolSignUp,
  confirmSignUp as poolConfirm,
  resendConfirmation,
  // ⬇️ new helper we'll add in lib/cognito.ts
  respondToAuthChallenge,
} from '@/lib/cognito';

type User = { username: string; groups?: string[]; isAdmin?: boolean } | null;

type Stored = {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  username: string;
  exp: number;
};

const KEY = 'nf_auth';
const cognitoDomain = process.env.NEXT_PUBLIC_COGNITO_DOMAIN!; 
const clientId      = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID!;
const postLogout    = process.env.NEXT_PUBLIC_LOGOUT_REDIRECT_URI!;

function readStored(): Stored | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStored(data: Stored | null) {
  if (typeof window === 'undefined') return;
  if (!data) window.localStorage.removeItem(KEY);
  else window.localStorage.setItem(KEY, JSON.stringify(data));
}

// What we return if MFA is required
export type MfaPending = {
  mfaRequired: true;
  username: string;
  challengeName: 'EMAIL_MFA' | 'EMAIL_OTP' | 'SMS_MFA' | 'SOFTWARE_TOKEN_MFA';
  session: string; // opaque Cognito session from step 1
};

export function useAuth() {
  const [token, setToken] = useState<string>('');
  const [user, setUser] = useState<User>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const s = readStored();
    if (s && s.idToken) {
      setToken(s.idToken);
      setUser({ username: s.username });
    }
    setReady(true);
  }, []);

  const finishLoginWithSession = async (
    username: string,
    idToken: string,
    accessToken: string,
    refreshToken: string
  ) => {
    // store cookie on your backend
    await api('/session', { method: 'POST', body: { idToken } });

    const payload = JSON.parse(atob(idToken.split('.')[1]));
    const exp = payload['exp'] as number;
    const groups: string[] = payload['cognito:groups'] || [];
    const adminGroup = process.env.NEXT_PUBLIC_COGNITO_ADMIN_GROUP || 'Admin';

    setToken(idToken);
    setUser({ username, groups, isAdmin: groups.includes(adminGroup) });
    writeStored({ idToken, accessToken, refreshToken, username, exp });
  };

  // ⬇️ UPDATED: returns void if fully logged in, or MfaPending if MFA required
  const login = async (username: string, password: string): Promise<void | MfaPending> => {
    // `cognitoLogin` should return either a full session (onSuccess) or
    // an object containing { challengeName, session, challengeParameters }.
    const res: any = await cognitoLogin(username, password);

    // Case 1: MFA required
    if (res?.challengeName && res?.session) {
      const challengeName = res.challengeName as MfaPending['challengeName'];
      return {
        mfaRequired: true,
        username,
        challengeName,
        session: res.session,
      };
    }

    // Case 2: fully authenticated (amazon-cognito-identity-js returns a CognitoUserSession)
    const idToken = res.getIdToken().getJwtToken();
    const accessToken = res.getAccessToken().getJwtToken();
    const refreshToken = res.getRefreshToken().getToken();

    await finishLoginWithSession(username, idToken, accessToken, refreshToken);
  };

  // ⬇️ NEW: answer the MFA/OTP step then finish login
  const completeMfa = async (
    pending: MfaPending,
    code: string
  ): Promise<void> => {
    const { username, session, challengeName } = pending;

    const answered = await respondToAuthChallenge({
      username,
      session,
      challengeName,
      code,
    });

    // When successful, Cognito gives a full AuthenticationResult (JWTs)
    const idToken = answered.getIdToken().getJwtToken();
    const accessToken = answered.getAccessToken().getJwtToken();
    const refreshToken = answered.getRefreshToken().getToken();

    await finishLoginWithSession(username, idToken, accessToken, refreshToken);
  };



  const logout = async () => {
  const s = readStored();
  setToken('');
  setUser(null);
  writeStored(null);
  signOut(); // clears local pool session only

  // (optional) revoke refresh token to invalidate server-side
  try {
    if (s?.refreshToken) {
      await fetch(`${cognitoDomain.replace(/\/$/, '')}/oauth2/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: s.refreshToken, client_id: clientId })
      });
    }
  } catch { /* ignore */ }

  // end Hosted UI session cookie
  const url = new URL(`${cognitoDomain.replace(/\/$/, '')}/logout`);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('logout_uri', postLogout);
  window.location.href = url.toString();
};

  const register = async (username: string, password: string, email?: string) => {
    await poolSignUp(username, password, email);
  };

  const confirm = async (username: string, code: string) => {
    await poolConfirm(username, code);
  };

  const resendCode = async (username: string) => {
    await resendConfirmation(username);
  };

  const maybeRefresh = async () => {
    const s = readStored();
    if (!s) return;
    const now = Math.floor(Date.now() / 1000);
    if (s.exp - now < 60) {
      // TODO: implement refresh flow if/when you store the CognitoUser instance.
    }
  };

  return {
    token,
    user,
    ready,
    login,
    completeMfa,  // ⬅️ expose new method
    logout,
    register,
    confirm,
    resendCode,
    api,
  };
}
