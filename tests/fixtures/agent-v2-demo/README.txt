Agent-v2 demo fixture. Files ending in .fixture are copied into a tmp dir by the tests
(tests/unit/agent-v2/support.ts) and renamed (server.ts, env.ts, .env.example). src/config.ts
holding a fake secret is generated at test time so no secret-like literal is ever committed.
