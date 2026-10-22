import { createRemoteJWKSet, jwtVerify } from "jose";

export type VerifiedIdentity = {
  uid: string;
  name?: string;
  email?: string;
  phone?: string;
};

export interface TokenVerifier {
  verify(token: string): Promise<VerifiedIdentity>;
}

export class AuthError extends Error {}

const FIREBASE_JWKS = new URL(
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
);

/**
 * Verifies Firebase Authentication ID tokens against Google's published keys.
 * Needs only the project id: no service account or secret.
 */
export class FirebaseTokenVerifier implements TokenVerifier {
  private readonly jwks = createRemoteJWKSet(FIREBASE_JWKS);

  constructor(private readonly projectId: string) {}

  async verify(token: string): Promise<VerifiedIdentity> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: `https://securetoken.google.com/${this.projectId}`,
        audience: this.projectId,
        algorithms: ["RS256"],
      });
      if (!payload.sub) throw new AuthError("token has no subject");
      return {
        uid: payload.sub,
        name: typeof payload.name === "string" ? payload.name : undefined,
        email: typeof payload.email === "string" ? payload.email : undefined,
        phone: typeof payload.phone_number === "string" ? payload.phone_number : undefined,
      };
    } catch (err) {
      throw err instanceof AuthError ? err : new AuthError("invalid token");
    }
  }
}

/**
 * Development only: accepts "dev:<uid>" or "dev:<uid>:<display name>".
 * Refused in production by loadConfig.
 */
export class DevTokenVerifier implements TokenVerifier {
  async verify(token: string): Promise<VerifiedIdentity> {
    const match = /^dev:([A-Za-z0-9_-]{1,64})(?::(.{1,80}))?$/.exec(token);
    if (!match) throw new AuthError("invalid dev token");
    return { uid: match[1]!, name: match[2] };
  }
}
