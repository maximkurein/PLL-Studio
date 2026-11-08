# PLL Studio — основные команды. `make` или `make help` — список.
.PHONY: help install dev web server app test check fmt lint build-mac build-mac-universal build-web version version-status bump-patch bump-minor bump-major clean
.DEFAULT_GOAL := help

PY ?= python3

help: ## Показать справку
	@$(PY) -c "import json;i=json.load(open('config/version.json'))['app_info'];print(f\"PLL Studio v{i['version']}\")"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

install: ## Установить npm-зависимости (Rust-зависимости cargo скачает сам)
	npm ci

app: ## Desktop-приложение в режиме разработки (Tauri + hot reload)
	npm run app

dev: ## Веб-интерфейс для разработки: сервер :7878 + Vite :1420 (Ctrl+C — остановить оба)
	@trap 'kill 0' INT TERM; cargo run -p pll-server -- --port 7878 & npm run dev; wait

web: ## Собрать фронтенд и запустить «удалённую лабораторию» на http://127.0.0.1:7878
	npm run web

server: ## Только pll-server (релизная сборка), раздаёт dist/
	npm run server

test: ## Тесты модели кристалла (pll-core)
	cargo test -p pll-core

check: ## Полная проверка: версии, типы TS, сборка фронтенда, тесты, cargo check
	$(PY) tools/update_version.py status
	$(PY) tools/test_update_version.py
	npm run build
	cargo test -p pll-core
	cargo check -p pll-server -p pll-studio
	cargo test -p pll-studio --lib

fmt: ## Форматирование Rust
	cargo fmt --all

lint: ## Clippy + проверка типов TypeScript
	cargo clippy --workspace
	npx tsc --noEmit

build-mac: ## Собрать .app + .dmg для этого Mac → release/vX.Y.Z/
	$(PY) build_macos.py

build-mac-universal: ## Universal .app + .dmg (Apple Silicon + Intel) и pll-server
	$(PY) build_macos.py --universal --with-server

build-web: ## Собрать фронтенд и релизный pll-server (без desktop-оболочки)
	npm run build
	cargo build --release -p pll-server

version: ## Показать текущую версию
	@$(PY) -c "import json;i=json.load(open('config/version.json'))['app_info'];print(f\"PLL Studio v{i['version']} ({i['release_date']})\")"

version-status: ## Проверить, что версия совпадает во всех файлах
	$(PY) tools/update_version.py status

bump-patch: ## Версия X.Y.Z → X.Y.(Z+1)
	$(PY) tools/update_version.py bump patch

bump-minor: ## Версия X.Y.Z → X.(Y+1).0
	$(PY) tools/update_version.py bump minor

bump-major: ## Версия X.Y.Z → (X+1).0.0
	$(PY) tools/update_version.py bump major

clean: ## Удалить артефакты сборки (cargo clean, dist/, release/)
	cargo clean
	rm -rf dist release src-tauri/gen
