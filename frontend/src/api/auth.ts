import { apiBaseUrl } from "../env";

const AUTH_TOKEN_KEY = "job_match_auth_token";
const AUTH_USERNAME_KEY = "job_match_auth_username";

export type AuthSession = {
  username: string;
};

export function readStoredAuthSession(): AuthSession | null {
  const token = readAuthToken();
  const username = sessionStorage.getItem(AUTH_USERNAME_KEY);

  if (!token || !username) {
    return null;
  }

  return { username };
}

export function clearStoredAuthSession() {
  sessionStorage.removeItem(AUTH_TOKEN_KEY);
  sessionStorage.removeItem(AUTH_USERNAME_KEY);
}

export async function authenticate(
  username: string,
  password: string,
  fetcher: typeof fetch = fetch,
): Promise<AuthSession> {
  const cleanUsername = username.trim();
  const cleanPassword = password.trim();

  if (!cleanUsername || !cleanPassword) {
    throw new Error("Введи логин и пароль.");
  }

  const token = createBasicAuthHeader(cleanUsername, cleanPassword);
  const response = await fetcher(`${apiBaseUrl}/auth/me`, {
    headers: {
      Authorization: token,
    },
  });

  if (!response.ok) {
    clearStoredAuthSession();
    throw new Error(response.status === 401 ? "Неверный логин или пароль." : `Ошибка входа: ${response.status}`);
  }

  const payload = (await response.json()) as Partial<AuthSession>;
  const session = { username: payload.username || cleanUsername };
  sessionStorage.setItem(AUTH_TOKEN_KEY, token);
  sessionStorage.setItem(AUTH_USERNAME_KEY, session.username);

  return session;
}

export async function fetchWithAuth(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const token = readAuthToken();

  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", token);
  }

  const response = await fetch(input, {
    ...init,
    headers,
  });

  if (response.status === 401) {
    clearStoredAuthSession();
  }

  return response;
}

function readAuthToken(): string | null {
  return sessionStorage.getItem(AUTH_TOKEN_KEY);
}

function createBasicAuthHeader(username: string, password: string): string {
  return `Basic ${btoa(`${username}:${password}`)}`;
}
