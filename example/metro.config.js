const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const path = require('path');

const defaultConfig = getDefaultConfig(__dirname);

// The SDK is the folder above (package.json: "file:.."). Watch its source, but
// take react and react-native only from this app: the SDK folder has its own
// copies (dev dependencies for its tests), and two copies of React Native in
// one bundle break the app.
const sdkRoot = path.resolve(__dirname, '..');
const escape = p => p.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&');

const config = {
  watchFolders: [sdkRoot],
  resolver: {
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
    extraNodeModules: {
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-native': path.resolve(__dirname, 'node_modules/react-native'),
    },
    blockList: [
      new RegExp(`^${escape(path.join(sdkRoot, 'node_modules'))}/(react|react-native)/.*$`),
    ],
  },
};

module.exports = mergeConfig(defaultConfig, config);
