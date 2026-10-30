const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Bundle SQLite packs (.db) as assets. .json stays a source file so that
// assets/data/daily-verses.json can be imported directly.
if (!config.resolver.assetExts.includes('db')) {
  config.resolver.assetExts.push('db');
}

module.exports = config;
