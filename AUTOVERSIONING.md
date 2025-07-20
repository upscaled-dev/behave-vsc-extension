# Autoversioning Setup

This project uses automated versioning with conventional commits. Here's how it works:

## 🚀 Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Make your first commit:**
   ```bash
   git add .
   git commit -m "feat: initial autoversioning setup"
   ```

3. **Create a release:**
   ```bash
   npm run release
   ```

## 📝 Commit Message Format

Use conventional commits format:

```
type(scope): description

[optional body]

[optional footer]
```

### Types:
- `feat`: New features (bumps minor version)
- `fix`: Bug fixes (bumps patch version)
- `docs`: Documentation changes (bumps patch version)
- `style`: Code style changes (bumps patch version)
- `refactor`: Code refactoring (bumps patch version)
- `perf`: Performance improvements (bumps patch version)
- `test`: Test changes (bumps patch version)
- `build`: Build system changes (bumps patch version)
- `ci`: CI configuration changes (bumps patch version)
- `chore`: Maintenance tasks (bumps patch version)
- `revert`: Revert previous commits (bumps patch version)

### Examples:
```bash
git commit -m "feat: add new test discovery feature"
git commit -m "fix: resolve issue with test execution"
git commit -m "docs: update README with new features"
git commit -m "feat!: breaking change in API"
```

## 🔧 Available Scripts

### Version Management
- `npm run version` - Automatically bump version based on commits
- `npm run release` - Create a new release with standard-version
- `npm run release:patch` - Force patch release
- `npm run release:minor` - Force minor release
- `npm run release:major` - Force major release

### Development
- `npm run commit` - Use commitizen for guided commits
- `npm run lint` - Run ESLint
- `npm run check-types` - Run TypeScript type checking
- `npm test` - Run all tests

## 🔄 Workflow

### For New Features:
1. Create a feature branch
2. Make changes
3. Write tests
4. Commit with conventional format: `git commit -m "feat: add new feature"`
5. Push and create PR
6. Merge to main
7. Run `npm run release` to create new version

### For Bug Fixes:
1. Create a fix branch
2. Fix the issue
3. Add tests
4. Commit: `git commit -m "fix: resolve issue description"`
5. Push and create PR
6. Merge to main
7. Run `npm run release` to create new version

## 🏷️ Version Bumping Rules

- **Patch** (0.0.x): Bug fixes, documentation, style changes
- **Minor** (0.x.0): New features (non-breaking)
- **Major** (x.0.0): Breaking changes

Breaking changes should include `!` in the commit message:
```bash
git commit -m "feat!: breaking change description"
```

## 🤖 Automated Workflows

### Pre-commit Hooks
- Runs linting
- Runs type checking
- Runs tests
- Validates commit message format

### GitHub Actions
- **CI**: Runs on every PR and push to main
- **Release**: Automatically creates releases and uploads VSIX files

## 📦 Publishing

1. **Local Release:**
   ```bash
   npm run release
   ```

2. **Force Specific Version:**
   ```bash
   npm run release:patch  # 0.0.1 → 0.0.2
   npm run release:minor  # 0.0.1 → 0.1.0
   npm run release:major  # 0.0.1 → 1.0.0
   ```

3. **Publish to VS Code Marketplace:**
   ```bash
   vsce publish
   ```

## 🔍 Troubleshooting

### Commit Message Validation
If your commit is rejected, ensure it follows the conventional format:
```bash
# ❌ Bad
git commit -m "fixed bug"

# ✅ Good
git commit -m "fix: resolve issue with test execution"
```

### Version Conflicts
If you need to force a specific version:
```bash
npm run release -- --release-as 1.0.0
```

### Skip Hooks (Emergency)
```bash
git commit -m "fix: emergency fix" --no-verify
```

## 📚 Additional Resources

- [Conventional Commits](https://www.conventionalcommits.org/)
- [Standard Version](https://github.com/conventional-changelog/standard-version)
- [Commitizen](http://commitizen.github.io/cz-cli/)
- [Husky](https://typicode.github.io/husky/) 