import { handleErrors } from './fetch.ts';

const AUTH_SESSION_URL = '/api/auth/session';
const AUTH_CSRF_URL = '/api/auth/csrfToken';
const AUTH_CREATE_SESSION_URL = '/api/auth/callback/anonymous';

type Session = {
  user: { id: string, role: string };
  expires: string;
}

export async function authenticate (baseURL: string) {
  const get = <T> (url: string): Promise<T> =>
    fetch(baseURL + url, {
      credentials: 'include',
      redirect: 'follow',
    })
      .then(handleErrors)
      .then(res => res.json());

  const post = (url: string, body: any): Promise<void> =>
    fetch(baseURL + url, {
      method: 'POST',
      credentials: 'include',
      redirect: 'manual',
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
      }
    })
      .then(handleErrors)
      .then(() => {});

  const session = await get<Session | null>(AUTH_SESSION_URL);

  if (!session) {
    const { csrfToken } = await get<{ csrfToken: string }>(AUTH_CSRF_URL);
    await post(AUTH_CREATE_SESSION_URL, { csrfToken });
    const session = await get<Session | null>(AUTH_SESSION_URL);

    if (!session?.user) {
      throw new Error('Authentication error');
    }

    return session;
  }
  return session;
}
