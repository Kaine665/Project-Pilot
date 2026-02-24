# Contributing to ProjectPilot

First off, thank you for considering contributing to ProjectPilot! It's people like you that make ProjectPilot such a great tool.

## Code of Conduct

This project and everyone participating in it is governed by our Code of Conduct. By participating, you are expected to uphold this code.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check the existing issues to avoid duplicates. When you create a bug report, include as many details as possible:

- **Use a clear and descriptive title**
- **Describe the exact steps to reproduce the problem**
- **Provide specific examples**
- **Describe the behavior you observed and what you expected**
- **Include screenshots if possible**
- **Include your environment details** (OS, Node version, etc.)

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion:

- **Use a clear and descriptive title**
- **Provide a detailed description of the suggested enhancement**
- **Explain why this enhancement would be useful**
- **List some examples of how it would be used**

### Pull Requests

1. Fork the repo and create your branch from `main`
2. If you've added code that should be tested, add tests
3. Ensure the test suite passes
4. Make sure your code lints
5. Write a clear commit message following our commit conventions

#### Commit Message Convention

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <subject>

<body>

<footer>
```

Types:
- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `style`: Changes that don't affect code meaning (formatting, etc.)
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `perf`: Performance improvement
- `test`: Adding missing tests
- `chore`: Changes to build process or auxiliary tools

Example:
```
feat(flow): add drag-and-drop for flow nodes

- Implement drag-and-drop functionality for flow nodes
- Add visual feedback during drag
- Update documentation

Closes #123
```

### Development Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/Project-Pilot.git
cd Project-Pilot

# Install dependencies
npm install

# Start development server
npm run dev

# Run tests (when available)
npm test

# Lint code
npm run lint
```

### Project Structure

```
src/
├── app/           # Next.js app router pages
├── components/    # React components
├── lib/           # Utility functions and core logic
├── types/         # TypeScript type definitions
└── data/          # Data files (gitignored in runtime)
```

### Coding Guidelines

- **TypeScript**: Use TypeScript for all new code
- **Formatting**: We use Prettier (will be auto-formatted)
- **Naming**: Use descriptive variable and function names
- **Comments**: Add comments for complex logic
- **File Organization**: Group related functionality together

### Testing Guidelines

(To be added as we implement testing)

### Documentation

- Update README.md if you change functionality
- Add JSDoc comments for public APIs
- Update relevant docs/ files for architecture changes

## Questions?

Feel free to open an issue with the `question` label or reach out to the maintainers.

## Recognition

Contributors will be recognized in our README and release notes. Thank you for making ProjectPilot better!
