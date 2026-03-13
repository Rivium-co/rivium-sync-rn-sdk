const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const path = require('path');

const defaultConfig = getDefaultConfig(__dirname);

// Watch the RiviumSync SDK source
const watchFolders = [
  path.resolve(__dirname, '../../react-native/rivium_sync'),
];

const config = {
  watchFolders,
  resolver: {
    nodeModulesPaths: [
      path.resolve(__dirname, 'node_modules'),
      path.resolve(__dirname, '../../react-native/rivium_sync/node_modules'),
    ],
  },
};

module.exports = mergeConfig(defaultConfig, config);
