.PHONY: help dev dev-local build test test-watch e2e typecheck check deploy deploy-only \
       release smoke require-app-url version migrate-local migrate-remote seed simulate logs clean

# Commit the Worker is deployed from: short hash, plus -dirty when the working
# tree has uncommitted changes (untracked files count). GET /api/health reports
# it as data.version.
GIT_SHA = $(shell git rev-parse --short HEAD)$(shell test -z "$$(git status --porcelain)" || echo -dirty)
DEPLOY = npx wrangler deploy --var GIT_SHA:$(GIT_SHA)

# Base URL of the deployed app, used by `make smoke` and `make release`.
# There is no default: pass it (make smoke APP_URL=https://...) or export it.
APP_URL ?=
APP_BASE = $(patsubst %/,%,$(APP_URL))

help: ## Show available commands
	@grep -E '^[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

dev: ## Run wrangler + vite concurrently
	bash scripts/dev.sh

dev-local: ## Run local Node.js server
	npx tsx scripts/serve-local.ts

build: ## Build frontend
	cd frontend && npx vite build

test: ## Run all tests
	npx vitest run

test-watch: ## Run tests in watch mode
	npx vitest

e2e: ## Build the frontend, then run the browser smoke suite (mocked API, local Chromium)
	npm run e2e

typecheck: ## Type check the Worker, the frontend and the e2e suite
	npm run typecheck

check: typecheck test ## Type check, then run all tests

deploy: check build ## Check, build and deploy the Worker (stamped with the commit)
	$(DEPLOY)

deploy-only: ## Deploy as is (skips checks and build; escape hatch)
	$(DEPLOY)

release: require-app-url check build ## Check, build, migrate all DBs, deploy, then smoke test (needs APP_URL)
	$(MAKE) --no-print-directory migrate-remote
	$(DEPLOY)
	$(MAKE) --no-print-directory smoke

version: ## Print the version string a deploy from this tree would carry
	@echo $(GIT_SHA)

require-app-url:
	@if [ -z "$(APP_BASE)" ]; then \
		echo "APP_URL is not set. Pass the deployed app's base URL, for example:"; \
		echo "  make smoke APP_URL=https://when2play.<your-subdomain>.workers.dev"; \
		echo "or export APP_URL in your shell profile."; \
		exit 1; \
	fi

smoke: require-app-url ## Check that APP_URL/api/health is ok and runs the local commit
	@expected="$(GIT_SHA)"; url="$(APP_BASE)/api/health"; \
	for attempt in 1 2 3 4 5 6; do \
		body=$$(curl -fsS --max-time 15 "$$url") || body=''; \
		ok=$$(printf '%s' "$$body" | jq -r '.ok' 2>/dev/null); \
		live=$$(printf '%s' "$$body" | jq -r '.data.version' 2>/dev/null); \
		if [ "$$ok" = "true" ] && [ "$$live" = "$$expected" ]; then break; fi; \
		[ $$attempt -lt 6 ] && sleep 5; \
	done; \
	echo "health:        $$url"; \
	echo "live version:  $${live:-unknown}"; \
	echo "local version: $$expected"; \
	if [ "$$ok" != "true" ]; then echo "FAIL: health check did not return ok: true ($${body:-no response})"; exit 1; fi; \
	if [ "$$live" != "$$expected" ]; then echo "FAIL: the live Worker does not run the local commit"; exit 1; fi; \
	echo "OK: the live Worker runs $$expected"

migrate-local: ## Apply migrations locally (all databases)
	@sed 's|//.*||' wrangler.jsonc | jq -r '.d1_databases[].database_name' | while read db; do \
		echo "Migrating (local): $$db"; \
		npx wrangler d1 migrations apply "$$db" --local; \
	done

migrate-remote: ## Apply migrations remotely (all databases)
	@sed 's|//.*||' wrangler.jsonc | jq -r '.d1_databases[].database_name' | while read db; do \
		echo "Migrating (remote): $$db"; \
		npx wrangler d1 migrations apply "$$db" --remote || exit 1; \
	done

seed: ## Seed test data
	bash scripts/seed-data.sh

simulate: ## Create test auth token
	bash scripts/simulate-bot.sh

logs: ## Stream live logs
	npx wrangler tail

clean: ## Clean build artifacts
	rm -rf frontend/dist .wrangler/local.sqlite
