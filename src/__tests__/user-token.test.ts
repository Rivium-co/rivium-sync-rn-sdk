/**
 * User token handling: the token provider, renewal before expiry, and the
 * "waiting for a user token" state of connect().
 */

const native = {
  init: jest.fn().mockResolvedValue(undefined),
  connect: jest.fn().mockResolvedValue(undefined),
  setUserToken: jest.fn().mockResolvedValue(undefined),
  isAwaitingUserToken: jest.fn().mockResolvedValue(true),
  isConnected: jest.fn().mockResolvedValue(false),
};
const listeners: Record<string, (payload?: any) => void> = {};
const appStateListeners: ((state: string) => void)[] = [];

jest.mock('react-native', () => ({
  NativeModules: { RiviumSync: native },
  NativeEventEmitter: jest.fn().mockImplementation(() => ({
    addListener: (event: string, cb: (payload?: any) => void) => {
      listeners[event] = cb;
      return { remove: jest.fn() };
    },
  })),
  Platform: { OS: 'ios', select: jest.fn((obj: any) => obj.ios) },
  AppState: { addEventListener: (_: string, cb: (state: string) => void) => appStateListeners.push(cb) },
}));

import RiviumSync from '../index';

/** A token shaped like the real one: only `sub` and `exp` matter here. */
function tokenFor(user: string, expiresInMs: number): string {
  const part = (json: object) =>
    Buffer.from(JSON.stringify(json)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${part({ alg: 'ES256' })}.${part({ sub: user, exp: Math.floor((Date.now() + expiresInMs) / 1000) })}.sig`;
}

const HOUR = 3_600_000;
let next: string | null = null;
let providerFails = false;
const provider = jest.fn(async () => {
  if (providerFails) throw new Error('backend unreachable');
  return next;
});

// RiviumSync is a singleton, so the order of these tests matters: the first
// one initialises the SDK for the rest.
describe('user token', () => {
  beforeEach(() => {
    native.setUserToken.mockClear();
    provider.mockClear();
  });

  it('init asks the provider and starts with its token', async () => {
    next = tokenFor('user-1', HOUR);
    await RiviumSync.init({ apiKey: 'rv_live_key', tokenProvider: provider });

    expect(provider).toHaveBeenCalledTimes(1);
    expect(native.init.mock.calls[0][0].userToken).toBe(next);
  });

  it("refreshUserToken hands the provider's token to the SDK", async () => {
    next = tokenFor('user-2', HOUR);
    await RiviumSync.refreshUserToken();

    expect(native.setUserToken).toHaveBeenCalledWith(next);
  });

  it('a signed-out provider clears the token', async () => {
    next = null;
    await RiviumSync.refreshUserToken();

    expect(native.setUserToken).toHaveBeenCalledWith(null);
  });

  it("a failing provider leaves the SDK's token alone", async () => {
    providerFails = true;
    await RiviumSync.refreshUserToken();
    providerFails = false;

    expect(native.setUserToken).not.toHaveBeenCalled();
  });

  it('renews the token shortly before it expires', async () => {
    jest.useFakeTimers();
    try {
      // Expires in 90 s, so the renewal is due about 30 s from now.
      next = tokenFor('user-1', 90_000);
      await RiviumSync.refreshUserToken();
      const renewed = tokenFor('user-1', HOUR);
      next = renewed;
      native.setUserToken.mockClear();

      await jest.advanceTimersByTimeAsync(20_000);
      expect(native.setUserToken).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(15_000);
      expect(native.setUserToken).toHaveBeenCalledWith(renewed);
    } finally {
      await RiviumSync.setTokenProvider(null); // stop the renewal of the one-hour token
      jest.useRealTimers();
    }
  });

  it('reports when connect is waiting for a user token', async () => {
    const onAwaiting = jest.fn();
    const remove = RiviumSync.onAwaitingUserToken(onAwaiting);

    listeners.onAwaitingUserToken();
    expect(onAwaiting).toHaveBeenCalledTimes(1);
    expect(await RiviumSync.isAwaitingUserToken()).toBe(true);

    remove();
    listeners.onAwaitingUserToken();
    expect(onAwaiting).toHaveBeenCalledTimes(1);
  });

  it('connect resolves while waiting for a token', async () => {
    await expect(RiviumSync.connect()).resolves.toBeUndefined();
  });
});
