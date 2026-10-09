.PHONY: help build dev test lint format audit clean install

help:
	@echo "Muraqib - Developer Environment Guardian & Performance Auditor"
	@echo ""
	@echo "Available commands:"
	@echo "  make build          Compile TypeScript to JavaScript"
	@echo "  make dev            Run in watch mode (auto-rebuild)"
	@echo "  make test           Run all tests with Vitest"
	@echo "  make lint           Run ESLint checks"
	@echo "  make format         Format code with Prettier"
	@echo "  make audit          Run full audit on http://localhost:3000"
	@echo "  make audit-ci       Collect audit data (CI mode)"
	@echo "  make clean          Remove build artifacts and cache"
	@echo "  make install        Install dependencies"
	@echo "  make start          Start the compiled application"
	@echo ""

install:
	npm install

build:
	npm run build

dev:
	npm run dev

test:
	npm test

lint:
	npm run lint

lint-fix:
	npm run lint -- --fix

format:
	npm run lint -- --fix

audit:
	npm run audit

audit-ci:
	npm run audit:ci

dev-server:
	npm run dev-server

clean:
	rm -rf dist coverage .vitest node_modules

start:
	npm start

.DEFAULT_GOAL := help
