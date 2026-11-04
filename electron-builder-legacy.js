// Édition « macOS ancien » : pour les Mac sous macOS 10.13 (High Sierra) à 11 (Big Sur),
// que la version normale (Electron récent, macOS 12 minimum) ne prend plus en charge.
// Elle reprend la configuration de package.json avec Electron 26, la dernière version
// compatible avec High Sierra. Tous ces Mac sont des Intel : x64 seulement.
//
//   npx electron-builder --mac --config electron-builder-legacy.js
const base = require('./package.json').build;

module.exports = {
  ...base,
  electronVersion: '26.6.10',
  mac: {
    ...base.mac,
    target: [{ target: 'dmg', arch: ['x64'] }],
    minimumSystemVersion: '10.13',
  },
  dmg: {
    ...base.dmg,
    artifactName: 'Jinglee-${version}-Mac-ancien.${ext}',
  },
  // latest-mac.yml appartient à la version normale : ne pas l'écraser.
  publish: base.publish.map((p) => ({ ...p, publishAutoUpdate: false })),
};
