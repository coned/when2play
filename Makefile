.PHONY: help dev dev-local build test test-watch deploy deploy-only \
       migrate-local migrate-remote seed simulate logs clean

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

deploy: build ## Build and deploy to Cloudflare
	npx wrangler deploy

deploy-only: ## Deploy without rebuilding
	npx wrangler deploy

migrate-local: ## Apply migrations locally
	npx wrangler d1 migrations apply when2play-db --local

migrate-remote: ## Apply migrations remotely
	npx wrangler d1 migrations apply when2play-db --remote

seed: ## Seed test data
	bash scripts/seed-data.sh

simulate: ## Create test auth token
	bash scripts/simulate-bot.sh

logs: ## Stream live logs
	npx wrangler tail

clean: ## Clean build artifacts
	rm -rf frontend/dist .wrangler/local.sqlite
