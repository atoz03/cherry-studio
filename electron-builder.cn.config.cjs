const { CHINA_EDITION } = require('./scripts/release/edition')

module.exports = async function createChinaEditionConfig() {
  return {
    extends: './electron-builder.yml',
    appId: 'com.cherryai.cherrystudio.cn',
    extraMetadata: {
      cherryEdition: CHINA_EDITION
    },
    // Fork: the China edition reads the same GitHub Releases as the global edition, from its own
    // `latest-cn*.yml` manifests so the two editions never install each other's packages.
    publish: {
      provider: 'github',
      owner: 'atoz03',
      repo: 'cherry-studio',
      channel: 'latest-cn'
    }
  }
}
