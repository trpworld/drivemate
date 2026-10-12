// DriveMate Phase 2 — Chrome Identity OAuth Wrapper
// Zero token leakage. Safe token lifecycle & error management.

export interface AuthState {
  isAuthenticated: boolean;
  userEmail?: string;
  error?: string;
}

export class GoogleAuthService {
  private static cachedToken: string | null = null;

  /**
   * Acquires a Google OAuth 2.0 access token via chrome.identity.
   * If interactive is true, prompts user if not already authorized.
   */
  public static async getAuthToken(interactive = true): Promise<string> {
    if (typeof chrome === 'undefined' || !chrome.identity) {
      throw new Error("chrome.identity API is unavailable in this environment.");
    }

    return new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive }, (token) => {
        if (chrome.runtime.lastError) {
          const errMsg = chrome.runtime.lastError.message || "OAuth authorization failed.";
          this.cachedToken = null;
          
          if (errMsg.includes("User cancelled") || errMsg.includes("user rejected") || errMsg.includes("approval prompt was denied")) {
            reject(new Error("Sign-in cancelled by user."));
          } else if (errMsg.includes("OAuth2 client ID")) {
            reject(new Error("Missing or invalid OAuth Client ID in manifest.json."));
          } else {
            reject(new Error(errMsg));
          }
          return;
        }

        if (!token) {
          this.cachedToken = null;
          reject(new Error("No OAuth token returned."));
          return;
        }

        this.cachedToken = token;
        resolve(token);
      });
    });
  }

  /**
   * Invalidates and clears the cached auth token.
   */
  public static async removeCachedToken(token?: string): Promise<void> {
    const tokenToRemove = token || this.cachedToken;
    if (!tokenToRemove || typeof chrome === 'undefined' || !chrome.identity) {
      this.cachedToken = null;
      return;
    }

    return new Promise((resolve) => {
      chrome.identity.removeCachedAuthToken({ token: tokenToRemove }, () => {
        this.cachedToken = null;
        resolve();
      });
    });
  }

  /**
   * Returns current cached token without printing or leaking.
   */
  public static getCurrentToken(): string | null {
    return this.cachedToken;
  }

  /**
   * Fetches user profile info (email only) using access token.
   */
  public static async getUserEmail(token: string): Promise<string | undefined> {
    try {
      const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        return data.email;
      }
    } catch {}
    return undefined;
  }
}
