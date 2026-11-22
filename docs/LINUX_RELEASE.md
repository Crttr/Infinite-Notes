# Linux: подготовка AppImage и DEB

**Блокер:** исходный бэкап не содержит `src-tauri`. Нужны `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, Rust-код и `src-tauri/capabilities/`.

После восстановления этих файлов проверьте, что Tauri 2 настроен на Linux, что `bundle.targets` включает `appimage` и `deb`, а Rust-команды используют переносимые пути.

Workflow `.github/workflows/ci.yml` запускает сборку фронтенда на Windows и Linux. Отдельная задача Linux Tauri сработает только при наличии `src-tauri/Cargo.toml`. Установка пакетов для Ubuntu 24.04: libwebkit2gtk-4.1-dev, build-essential, curl, wget, file, libxdo-dev, libssl-dev, librsvg2-dev, libayatana-appindicator3-dev, patchelf.

Сборка Tauri: `npm run tauri -- build --bundles appimage,deb` (после установки Rust и зависимостей). Итоговые пакеты нужно протестировать на реальном Linux или VM. GitHub Actions может собрать, но не заменить ручной smoke-test.
