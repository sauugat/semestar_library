const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// Watch shared packages directory
config.watchFolders = [
  path.resolve(workspaceRoot, 'packages/ludo-engine'),
];

// Map canonical shared engine package to source directory
config.resolver.extraNodeModules = {
  '@semester-library/ludo-engine': path.resolve(workspaceRoot, 'packages/ludo-engine/src'),
};

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
];

module.exports = config;
