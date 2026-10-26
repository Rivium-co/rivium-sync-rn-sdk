import RiviumSync, {SyncCollection, SyncQuery} from '@rivium/sync-react-native';
import {AppConfig} from './config';

/**
 * Stands in for YOUR backend, so this example can run against a project that
 * has "Require signed user tokens" turned on.
 *
 * Security Rules read `auth.uid`. An app cannot decide that value: its API key
 * ships inside the app, so anyone could claim any user. Only a server holding
 * the project's server secret can mint a user token.
 *
 * In a real app, the token provider calls your own endpoint, behind your own
 * login, that mints a token for the user who is actually signed in (the Node
 * SDK's `createUserToken` does this). The server secret must never be in an
 * app - this example only reads it in development builds, from config.ts.
 */

/** The local server when config.ts names one (development builds only). */
export const emulatorHost: string = __DEV__ ? AppConfig.emulatorHost ?? '' : '';

const apiUrl = emulatorHost ? `http://${emulatorHost}:3006` : 'https://sync.rivium.co';
const serverSecret: string = __DEV__ ? AppConfig.serverSecret ?? '' : '';
const demoUserId: string = AppConfig.demoUserId || 'rn-demo-user';

let currentUser = demoUserId;

/** True when config.ts gave this development build a server secret. */
export const isMinterConfigured = serverSecret.length > 0;

/** The signed-in demo user. Documents carry it as `userId`, which the default "owner only" rules check. */
export function currentUserId(): string {
  return currentUser;
}

/** The other demo user's id (demoUserId + "-2"). */
export function otherUserId(): string {
  return currentUser === demoUserId ? `${demoUserId}-2` : demoUserId;
}

/** Sign in as the other demo user: the SDK asks the token provider again and reconnects as that user. */
export async function switchUser(): Promise<void> {
  currentUser = otherUserId();
  await RiviumSync.refreshUserToken();
}

/**
 * The token provider: mints a token for the demo user. Called at init, shortly
 * before the token expires, and on refreshUserToken().
 */
export async function fetchDemoToken(): Promise<string | null> {
  if (!isMinterConfigured) return null;
  const userId = currentUser;
  const response = await fetch(`${apiUrl}/users/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': AppConfig.apiKey,
      'x-server-secret': serverSecret,
    },
    body: JSON.stringify({userId}),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    console.warn(`[DemoTokenMinter] Token request failed (${response.status})`);
    return null;
  }
  const token = body?.token ?? body?.data?.token;
  if (typeof token !== 'string') {
    console.warn('[DemoTokenMinter] No token in the answer');
    return null;
  }
  console.log(`[DemoTokenMinter] Minted a user token for ${userId}`);
  return token;
}

/**
 * The signed-in user's documents. Security Rules are not filters: a list or
 * listener must filter on the field the rules read (here userId), or the
 * server refuses it with `query_not_allowed`.
 */
export function mine(collection: SyncCollection): SyncQuery {
  return collection.where('userId', '==', currentUser);
}
