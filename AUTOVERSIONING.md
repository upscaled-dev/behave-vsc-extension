# Versioning and releases

The canonical [release process](CONTRIBUTING.md#release-process) documents version commands, tag checks, artifact verification and publication.

Only the explicit `npm run release` commands advance versions and create a release commit and tag. Builds and VSIX packaging keep the checked-out version. The tag workflow publishes the same verified artifact to GitHub and the Marketplace.

Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages. The release configuration lives in `.versionrc.js`.
