# Security Policy

## Reporting Security Vulnerabilities

**Please do not open public GitHub issues for security vulnerabilities.** This could expose the vulnerability before a fix is available.

Instead, please email security concerns to: **aya.alaasel123@gmail.com**

Include the following information:
- Description of the vulnerability
- Steps to reproduce (if applicable)
- Affected version(s)
- Potential impact
- Suggested fix (if available)

We will acknowledge your report within 48 hours and provide updates on our progress toward a fix.

## Supported Versions

| Version | Supported          |
|---------|-------------------|
| 1.x     | ✅ Full support   |
| < 1.0   | ❌ No support     |

## Security Best Practices

### Environment Variables
- Never commit `.env` files to version control
- Use `.env.example` to document required variables
- Use Muraqib's `createEnv()` or `safeCreateEnv()` to validate environment variables at runtime
- Avoid storing secrets in application code

### Audit Modules
- **Security Headers Audit** — validates security headers on target URLs
- **Dependency Guard** — detects deprecated APIs and vulnerable package versions
- **Configuration Guard** — identifies insecure configuration files

### Preset System
- Remote presets are fetched and validated
- Use only trusted preset URLs
- Presets are validated against schema before application

## Dependencies

Muraqib depends on the following security-critical packages:
- **zod** — Runtime schema validation
- **valibot** — Alternative validation library
- **arktype** — Type-safe validation
- **axios** — HTTP client with security headers
- **chalk** — Terminal styling (no security impact)

All dependencies are:
- Regularly updated
- Scanned for vulnerabilities using `npm audit`
- Tested before release

## CI/CD Security

- Tests run on every push to `main` and feature branches
- ESLint enforces code quality standards
- TypeScript strict mode catches type-safety issues
- Build artifacts are verified to ensure integrity

## Acknowledgments

We appreciate the security research community's efforts to improve Muraqib's security posture.
