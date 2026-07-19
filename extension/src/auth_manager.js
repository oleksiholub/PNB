(function (global) {
  "use strict";

  const IDENTITY_TOOLKIT_BASE = "https://identitytoolkit.googleapis.com/v1";
  const SECURE_TOKEN_BASE = "https://securetoken.googleapis.com/v1";

  const STORAGE_KEY_ID_TOKEN = "pnb_firebase_id_token";
  const STORAGE_KEY_REFRESH_TOKEN = "pnb_firebase_refresh_token";
  const STORAGE_KEY_EXPIRES_AT = "pnb_firebase_token_expires_at";

  class AuthManager {
    constructor(firebaseApiKey) {
      this.apiKey = firebaseApiKey;
    }

    async _storageGet(keys) {
      return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
    }

    async _storageSet(obj) {
      return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
    }

    async signInWithPassword(email, password) {
      const url = `${IDENTITY_TOOLKIT_BASE}/accounts:signInWithPassword?key=${this.apiKey}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(`Firebase sign-in failed: HTTP ${response.status} ${JSON.stringify(errBody)}`);
      }

      const data = await response.json();
      const expiresAt = Date.now() + Number(data.expiresIn) * 1000;

      await this._storageSet({
        [STORAGE_KEY_ID_TOKEN]: data.idToken,
        [STORAGE_KEY_REFRESH_TOKEN]: data.refreshToken,
        [STORAGE_KEY_EXPIRES_AT]: expiresAt,
      });

      return data.idToken;
    }

    async _refreshIdToken(refreshToken) {
      const url = `${SECURE_TOKEN_BASE}/token?key=${this.apiKey}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
      });

      if (!response.ok) {
        throw new Error(`Firebase token refresh failed: HTTP ${response.status}`);
      }

      const data = await response.json();
      const expiresAt = Date.now() + Number(data.expires_in) * 1000;

      await this._storageSet({
        [STORAGE_KEY_ID_TOKEN]: data.id_token,
        [STORAGE_KEY_REFRESH_TOKEN]: data.refresh_token,
        [STORAGE_KEY_EXPIRES_AT]: expiresAt,
      });

      return data.id_token;
    }

    async getIdToken() {
      const stored = await this._storageGet([
        STORAGE_KEY_ID_TOKEN,
        STORAGE_KEY_REFRESH_TOKEN,
        STORAGE_KEY_EXPIRES_AT,
      ]);

      if (!stored[STORAGE_KEY_ID_TOKEN] || !stored[STORAGE_KEY_REFRESH_TOKEN]) {
        throw new Error("No Firebase session found - sign-in required before getIdToken() can succeed");
      }

      const expiresAt = stored[STORAGE_KEY_EXPIRES_AT] || 0;
      const fiveMinutesMs = 5 * 60 * 1000;

      if (Date.now() < expiresAt - fiveMinutesMs) {
        return stored[STORAGE_KEY_ID_TOKEN];
      }

      return this._refreshIdToken(stored[STORAGE_KEY_REFRESH_TOKEN]);
    }

    async isSignedIn() {
      const stored = await this._storageGet([STORAGE_KEY_ID_TOKEN]);
      return !!stored[STORAGE_KEY_ID_TOKEN];
    }
  }

  global.PNB = global.PNB || {};
  global.PNB.AuthManager = AuthManager;
})(self);