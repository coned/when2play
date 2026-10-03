# Deploy commands, run from this repo root on the developer machine.
# The bot runs on $(REMOTE_HOST) as the user-level systemd service in deploy/$(SERVICE).service.
# Deploy order: Worker migrations, then the Worker, then this bot (it needs POST /api/users/sync).

REMOTE_HOST ?= Celliwig
REMOTE_USER ?= william
REMOTE_DIR ?= ~/deploy/when2play_discordbot
SERVICE ?= when2play-bot

SSH := ssh $(REMOTE_USER)@$(REMOTE_HOST)
# errors.log is excluded so --delete does not wipe the remote error log.
# .env and node_modules are intentionally synced.
SYNC_CMD := rsync -avz --delete --exclude '.git/' --exclude '.claude/' --exclude '.local/' --exclude 'errors.log' -e ssh ./ $(REMOTE_USER)@$(REMOTE_HOST):$(REMOTE_DIR)/
RESTART_CMD := $(SSH) 'systemctl --user restart $(SERVICE) && systemctl --user --no-pager status $(SERVICE) | head -n 15'

.PHONY: run test sync restart deploy install-service logs

# Local run in the foreground (development only; production runs under systemd)
run:
	node --env-file=.env bot.mjs

test:
	npm test

sync:
	$(SYNC_CMD)

restart:
	$(RESTART_CMD)

# Tests first, then sync, then restart (one recipe so the order holds even with make -j)
deploy:
	npm test
	$(SYNC_CMD)
	$(RESTART_CMD)

install-service:
	$(SSH) 'mkdir -p ~/.config/systemd/user \
		&& cp $(REMOTE_DIR)/deploy/$(SERVICE).service ~/.config/systemd/user/ \
		&& systemctl --user daemon-reload \
		&& systemctl --user enable $(SERVICE) \
		&& loginctl enable-linger $(REMOTE_USER)'

logs:
	$(SSH) 'journalctl --user -u $(SERVICE) -n 50 --no-pager'
