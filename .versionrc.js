export default {
  types: [
    { type: 'feat', section: '✨ Features' },
    { type: 'fix', section: '🐛 Bug Fixes' },
    { type: 'docs', section: '📚 Documentation' },
    { type: 'style', section: '💄 Styles' },
    { type: 'refactor', section: '♻️ Code Refactoring' },
    { type: 'perf', section: '⚡ Performance Improvements' },
    { type: 'test', section: '✅ Tests' },
    { type: 'build', section: '📦 Build System' },
    { type: 'ci', section: '👷 CI Configuration' },
    { type: 'chore', section: '🔧 Chores' },
    { type: 'revert', section: '⏪ Reverts' }
  ],
  releaseCommitMessageFormat: 'chore(release): 📦 {{currentTag}}',
  issuePrefixes: ['#'],
  commitUrlFormat: 'https://github.com/your-username/behave-test-runner/commit/{{hash}}',
  compareUrlFormat: 'https://github.com/your-username/behave-test-runner/compare/{{previousTag}}...{{currentTag}}',
  issueUrlFormat: 'https://github.com/your-username/behave-test-runner/issues/{{id}}',
  userUrlFormat: 'https://github.com/{{user}}',
  releaseRules: [
    { type: 'feat', release: 'minor' },
    { type: 'fix', release: 'patch' },
    { type: 'docs', release: 'patch' },
    { type: 'style', release: 'patch' },
    { type: 'refactor', release: 'patch' },
    { type: 'perf', release: 'patch' },
    { type: 'test', release: 'patch' },
    { type: 'build', release: 'patch' },
    { type: 'ci', release: 'patch' },
    { type: 'chore', release: 'patch' },
    { breaking: true, release: 'major' }
  ],
  parserOpts: {
    noteKeywords: ['BREAKING CHANGE', 'BREAKING CHANGES']
  }
};
