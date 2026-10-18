// Filled in at build time (see Dockerfile / vite.config.js)
const env = import.meta.env;

export const build = {
  version: env.VITE_APP_VERSION || 'dev',
  sha: env.VITE_GIT_SHA || '',
  time: env.VITE_BUILD_TIME || '',
  repo: (env.VITE_REPO_URL || 'https://github.com/Jake-double-one/shopwiz').replace(/\/+$/, ''),
};

/** Link for the running version: the release for tagged builds, the commit otherwise. */
export function versionUrl() {
  // a release tag links to the release; "v0.4.0-3-g1a2b3c4" (main after a release) to the commit
  if (build.version !== 'latest' && build.version !== 'dev' && !/^[0-9a-f]{7,40}$/.test(build.version) && !/-g[0-9a-f]{7,}$/.test(build.version)) {
    return `${build.repo}/releases/tag/${encodeURIComponent(build.version)}`;
  }
  return build.sha ? `${build.repo}/commit/${build.sha}` : build.repo;
}
