# Installation

> Part of the [Muraqib documentation](../README.md).

## 📦 Usage from npm

The npm package is `@muraqib/core`; the CLI command it installs is `muraqib`.
The muraqib version will be available after publication:

```bash
# Full audit
npx @muraqib/core audit

# Guided interactive mode (Clack)
npx @muraqib/core audit -i

# Install locally, then use the CLI command
npm install -D @muraqib/core
npx muraqib audit
```

> After installing `@muraqib/core`, use `npx muraqib`.
> Without a local installation, use `npx @muraqib/core@beta`.

In CI, pass `--no-interactive` and use `--fail-on-warning` when warnings should block the build.
### Optional peer dependencies

The default install is lightweight. These packages are optional peer dependencies; install only what you use:

Generated from `package.json` (`peerDependencies`):

<!-- AUTO:peer-deps:start -->
| Package | Range | Kind | Install |
|---------|-------|------|---------|
| `@google/genai` | `^2.22.0` | optional | `npm i @google/genai` |
| `arktype` | `^2.2.0` | optional | `npm i arktype` |
| `valibot` | `^1.4.0` | optional | `npm i valibot` |
<!-- AUTO:peer-deps:end -->

Used for: `valibot` → `--engine valibot` / `ValibotEngine`; `arktype` → `--engine arktype` / `ArktypeEngine`; `@google/genai` → AI advisor (`--ai-advisory`, Gemini).

`zod` is installed with `@muraqib/core` because the built-in environment presets use it internally. If an optional package is missing, Muraqib fails with an actionable message such as `install valibot to use engine 'valibot'`; the AI advisor degrades gracefully (a one-time warning, audit continues). HTTP probes use the built-in `fetch`, so there is no HTTP client dependency.
