/**
 * The package hands its identity to the native SDK, which sends
 * `X-Rivium-SDK: react-native/<version> android|ios/<native version>`.
 */

const native = {
  init: jest.fn().mockResolvedValue(undefined),
};

jest.mock('react-native', () => ({
  NativeModules: { RiviumSync: native },
  NativeEventEmitter: jest.fn().mockImplementation(() => ({
    addListener: jest.fn(() => ({ remove: jest.fn() })),
  })),
  Platform: { OS: 'ios', select: jest.fn((obj: any) => obj.ios) },
  AppState: { addEventListener: jest.fn() },
}));

import RiviumSync, { SDK_NAME, SDK_VERSION } from '../index';

const { version } = require('../../package.json');

describe('X-Rivium-SDK', () => {
  it('SDK_VERSION matches package.json', () => {
    expect(SDK_NAME).toBe('react-native');
    expect(SDK_VERSION).toBe(version);
  });

  it('init passes the wrapper identity to the native SDK', async () => {
    await RiviumSync.init({ apiKey: 'rv_live_test' });

    expect(native.init).toHaveBeenCalledTimes(1);
    const options = native.init.mock.calls[0][0];
    expect(options.apiKey).toBe('rv_live_test');
    expect(options.wrapperSdkName).toBe('react-native');
    expect(options.wrapperSdkVersion).toBe(version);
  });
});
