// src/lib/cognito.ts
import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserAttribute,
  CognitoUserPool,
  CognitoUserSession,
} from 'amazon-cognito-identity-js';
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
  RespondToAuthChallengeCommandOutput,
} from '@aws-sdk/client-cognito-identity-provider';

// ---------- env ----------
const userPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID!;
const clientId   = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID!;
const region     = process.env.NEXT_PUBLIC_AWS_REGION || process.env.AWS_REGION || 'ap-southeast-2';

// ---------- pool & sdk clients ----------
const pool = new CognitoUserPool({ UserPoolId: userPoolId, ClientId: clientId });
const cip  = new CognitoIdentityProviderClient({ region });

// ---------- types ----------
export type MfaChallengeName =
  | 'EMAIL_MFA'
  | 'EMAIL_OTP'
  | 'SMS_MFA'
  | 'SOFTWARE_TOKEN_MFA'
  | 'CUSTOM_CHALLENGE';

export type MfaPending = {
  mfaRequired: true;
  username: string;
  challengeName: MfaChallengeName;
  session: string;
};

export type AuthResult = CognitoUserSession | MfaPending;

// ---------- helpers ----------
function codeKeyFor(challengeName: MfaChallengeName): string {
  switch (challengeName) {
    case 'EMAIL_MFA': return 'EMAIL_MFA_CODE';
    case 'EMAIL_OTP': return 'EMAIL_OTP_CODE';
    case 'SMS_MFA': return 'SMS_MFA_CODE';
    case 'SOFTWARE_TOKEN_MFA': return 'SOFTWARE_TOKEN_MFA_CODE';
    case 'CUSTOM_CHALLENGE': return 'ANSWER';
    default: return 'ANSWER';
  }
}

function adaptAuthResultToSession(r: {
  IdToken?: string | undefined;
  AccessToken?: string | undefined;
  RefreshToken?: string | undefined;
}): CognitoUserSession {
  const idTok = r.IdToken!;
  const accTok = r.AccessToken!;
  const refTok = r.RefreshToken!;
  // Duck-typed minimal surface used by your hook
  return {
    getIdToken: () => ({ getJwtToken: () => idTok } as any),
    getAccessToken: () => ({ getJwtToken: () => accTok } as any),
    getRefreshToken: () => ({ getToken: () => refTok } as any),
  } as any;
}

function extractUserSessionString(u: CognitoUser): string {
  // @ts-ignore internal property on the lib's object
  return (u as any)?.Session || '';
}

// ---------- PREFERRED: Password auth (no SRP) ----------
async function passwordAuthLogin(username: string, password: string): Promise<AuthResult> {
  const cmd = new InitiateAuthCommand({
    ClientId: clientId,
    AuthFlow: 'USER_PASSWORD_AUTH',
    AuthParameters: {
      USERNAME: username,
      PASSWORD: password,
    },
  });

  const out = await cip.send(cmd);

  // MFA challenge
  if (out.ChallengeName && out.Session) {
    return {
      mfaRequired: true,
      username,
      challengeName: out.ChallengeName as MfaChallengeName,
      session: out.Session,
    };
  }

  // Fully authenticated
  if (out.AuthenticationResult?.IdToken && out.AuthenticationResult.AccessToken && out.AuthenticationResult.RefreshToken) {
    return adaptAuthResultToSession(out.AuthenticationResult);
  }

  throw new Error('Unexpected sign-in response');
}

// ---------- FALLBACK: SRP via amazon-cognito-identity-js ----------
async function srpAuthLogin(username: string, password: string): Promise<AuthResult> {
  const user = new CognitoUser({ Username: username, Pool: pool });
  // Defensive: make sure flow is SRP (default)
  user.setAuthenticationFlowType?.('USER_SRP_AUTH');

  const auth = new AuthenticationDetails({ Username: username, Password: password });

  return new Promise<AuthResult>((resolve, reject) => {
    user.authenticateUser(auth, {
      onSuccess: (session: CognitoUserSession) => resolve(session),
      onFailure: (err) => reject(err),

      mfaRequired: (challengeName /*, challengeParams*/) => {
        resolve({
          mfaRequired: true,
          username,
          challengeName: (challengeName as MfaChallengeName) ?? 'SMS_MFA',
          session: extractUserSessionString(user),
        });
      },

      customChallenge: () => {
        resolve({
          mfaRequired: true,
          username,
          challengeName: 'CUSTOM_CHALLENGE',
          session: extractUserSessionString(user),
        });
      },

      totpRequired: () => {
        resolve({
          mfaRequired: true,
          username,
          challengeName: 'SOFTWARE_TOKEN_MFA',
          session: extractUserSessionString(user),
        });
      },
    });
  });
}

// ---------- PUBLIC: login wrapper ----------
export async function cognitoLogin(username: string, password: string): Promise<AuthResult> {
  try {
    // Prefer password auth to avoid device metadata paths entirely
    return await passwordAuthLogin(username, password);
  } catch (e: any) {
    // If the client doesn’t allow USER_PASSWORD_AUTH, Cognito returns e.g. InvalidParameterException
    // Fallback to SRP using amazon-cognito-identity-js
    return await srpAuthLogin(username, password);
  }
}

// ---------- MFA: respond to challenge ----------
export async function respondToAuthChallenge(args: {
  username: string;
  session: string;
  challengeName: MfaChallengeName;
  code: string;
}): Promise<CognitoUserSession> {
  const { username, session, challengeName, code } = args;

  const cmd = new RespondToAuthChallengeCommand({
    ClientId: clientId,
    ChallengeName: challengeName as any,
    Session: session,
    ChallengeResponses: {
      USERNAME: username,
      [codeKeyFor(challengeName)]: code,
    },
  });

  const out: RespondToAuthChallengeCommandOutput = await cip.send(cmd);

  const r = out.AuthenticationResult;
  if (r?.IdToken && r.AccessToken && r.RefreshToken) {
    return adaptAuthResultToSession(r);
  }

  throw new Error('MFA verification failed');
}

// ---------- Sign up / confirm / resend / current user / signOut ----------
export function signUp(username: string, password: string, email?: string) {
  return new Promise<{ user: CognitoUser }>((resolve, reject) => {
    const attrList: CognitoUserAttribute[] = email
      ? [new CognitoUserAttribute({ Name: 'email', Value: email })]
      : [];

    pool.signUp(username, password, attrList, [], (err, result) => {
      if (err || !result) return reject(err);
      resolve({ user: result.user });
    });
  });
}

export function confirmSignUp(username: string, code: string) {
  const user = new CognitoUser({ Username: username, Pool: pool });
  return new Promise<void>((resolve, reject) => {
    user.confirmRegistration(code, true, (err) => (err ? reject(err) : resolve()));
  });
}

export function resendConfirmation(username: string) {
  const user = new CognitoUser({ Username: username, Pool: pool });
  return new Promise<void>((resolve, reject) => {
    user.resendConfirmationCode((err) => (err ? reject(err) : resolve()));
  });
}

export function getCurrentUser(): CognitoUser | null {
  return pool.getCurrentUser();
}

export function signOut() {
  const u = pool.getCurrentUser();
  if (u) u.signOut();
}
