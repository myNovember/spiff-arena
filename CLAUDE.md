# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Monorepo for SpiffArena, a platform for building, running, and monitoring executable BPMN/DMN diagrams:

- `spiffworkflow-backend/` — Python (Flask + connexion, served via uvicorn ASGI), managed with `uv`
- `spiffworkflow-frontend/` — React 19 + Vite + TypeScript, managed with `npm`
- `spiff-arena-common/` — small Python package (uv workspace member of the root `pyproject.toml`); the backend uses its `JinjaHelpers`

See also `AGENTS.md`, `spiffworkflow-backend/AGENTS.md`, `spiffworkflow-frontend/AGENTS.md`. When changing BPMN/RJSF/Arena behavior, check whether the docs in `docs/` cover it and call out gaps (per root `AGENTS.md`).

## Commands

### Everything (lint + typecheck + backend tests)

    ./bin/run_pyl          # from repo root; use the ROOT uv env, not the backend's

`run_pyl` runs frontend `npm run lint:fix` (if frontend changed), pre-commit (backend only: ruff check/format, ast-grep scan/test, yaml/toml checks), `uv run mypy`, then `./bin/tests-par`.

### Backend (`cd spiffworkflow-backend`)

    uv sync                                    # add --extra postgres / --extra mysql for those DB drivers
    SPIFFWORKFLOW_BACKEND_DATABASE_TYPE=sqlite ./bin/recreate_db clean   # required once before tests
    ./bin/tests-par                            # all tests, parallel sqlite (pytest -n auto -x --random-order)
    uv run pytest tests/spiffworkflow_backend/integration/test_process_model_milestones.py
    uv run pytest -k test_process_instance_list_filter
    ./bin/recreate_db clean                    # dev DB (mysql by default; honors SPIFFWORKFLOW_BACKEND_DATABASE_URI)
    uv run flask db upgrade                    # apply migrations (migrations/ is alembic via Flask-Migrate)
    ./bin/run_server_locally                   # API on :7000 (refreshes caches, bootstraps, then uvicorn --reload)
    ./bin/run_server_locally celery_worker     # optional celery worker

`run_server_locally` needs `SPIFFWORKFLOW_BACKEND_BPMN_SPEC_ABSOLUTE_DIR`; if unset it clones `sample-process-models` next to the repo.

### Frontend (`cd spiffworkflow-frontend`)

    npm install
    npm start              # vite dev server on :7001
    npm test               # vitest run --coverage
    npm run lint           # eslint --max-warnings 0   (npm run lint:fix to fix)
    npm run typecheck      # tsc --noEmit
    npm run check          # typecheck + lint fixes + tests

Playwright e2e tests live in `spiffworkflow-frontend/test/browser` (`uv run pytest ...` there); `./bin/agents/run_playwright.sh` from root starts servers and runs them.

### Windows notes

- `bin/*` scripts are bash; run them from Git Bash.
- `npm start` sets env inline (`VITE_VERSION_INFO=... vite`) and fails under cmd.exe; run `VITE_VERSION_INFO='{"version":"local"}' npx vite` from bash instead.
- uvicorn `--reload` on Windows leaves a `multiprocessing.spawn` child holding port 7000 when the parent is killed; kill that child too.

## Backend architecture (`spiffworkflow-backend/src/spiffworkflow_backend/`)

**Request flow.** `spiff_web_server.py:asgi_app` → `create_asgi_app()` in `__init__.py`, which wraps `create_app()`: connexion `FlaskApp` + `add_api("api.yml")`. Every `operationId` in `api.yml` is a full dotted path into `routes/*_controller.py`. `api.yml` declares `security: []`; auth is done by `app.before_request(omni_auth)` (`routes/authentication_controller.py`) → `AuthorizationService.check_for_permission`. Permissions are loaded from `config/permissions/<SPIFFWORKFLOW_BACKEND_PERMISSIONS_FILE_NAME>.yml`. A built-in OpenID provider (`routes/openid_blueprint/`, users from the permissions yml) is used for local dev instead of keycloak.

**Config layering** (`config/__init__.py:setup_config`): `config/default.py` (every setting via `config_from_env`) → `config/<SPIFFWORKFLOW_BACKEND_ENV>.py` (default `local_development`) → `src/instance/config.py` (gitignored, local overrides; not loaded for `unit_testing`) → `config/secrets.py` (gitignored). Nested env vars like `SPIFFWORKFLOW_BACKEND_AUTH_CONFIGS__0__uri` are parsed into lists/dicts by `config/normalized_environment.py`. `FLASK_SESSION_SECRET_KEY` must be an env var (`app.secret_key` reads `os.environ`). DB URI comes from `SPIFFWORKFLOW_BACKEND_DATABASE_URI` or is derived from `SPIFFWORKFLOW_BACKEND_DATABASE_TYPE` (mysql | postgres | sqlite).

**Process models live on the filesystem**, not in the DB: `SPIFFWORKFLOW_BACKEND_BPMN_SPEC_ABSOLUTE_DIR` holds directories marked by `process_group.json` / `process_model.json` plus `.bpmn`/`.dmn`/`.json` files (`FileSystemService`, `ProcessModelService`, `SpecFileService`). The DB holds derived caches (`ReferenceCacheModel`, message/data-store refs) rebuilt by `bin/refresh_all_caches.py` → `DataSetupService.refresh_process_model_caches()`. `services/git_service.py` handles commit-on-save, publish, and webhook sync of that directory.

**Execution.** `ProcessInstanceService.run_process_instance_with_runtime` → `ProcessInstanceRuntime` (`services/process_instance_runtime.py`) wraps the SpiffWorkflow `BpmnWorkflow`. `do_engine_steps` runs under `ProcessInstanceQueueService.dequeued(...)` (row lock in `process_instance_queue`), then `WorkflowExecutionService` with an `ExecutionStrategy` (greedy, queue-for-end-user, …) and `TaskModelSavingDelegate`. Workflow state is not pickled: `ProcessInstancePersistenceService` / `TaskService` decompose it into `bpmn_process`, `bpmn_process_definition`, `task`, `task_definition`, with data deduplicated into `json_data` via `*_data_hash` columns. Script tasks run in `CustomBpmnScriptEngine` (`services/process_instance_script_engine.py`); callable helpers are `Script` subclasses in `scripts/` (auto-discovered), plus global scripts from the process model repo.

**Background processing** (`background_processing/`): apscheduler runs in-process only if `SPIFFWORKFLOW_BACKEND_RUN_BACKGROUND_SCHEDULER_IN_CREATE_APP`, else via `bin/start_blocking_apscheduler`. With `SPIFFWORKFLOW_BACKEND_CELERY_ENABLED` it only queues future timer tasks to celery (`celery_tasks/process_instance_task.py`); without celery it polls waiting/running instances itself. Message correlation runs every 10s either way.

**Tests** (`tests/spiffworkflow_backend/{unit,integration,scripts}`): `conftest.py` forces `SPIFFWORKFLOW_BACKEND_ENV=unit_testing` (sqlite `db_unit_testing_gwN.sqlite3` per xdist worker, `unit_testing.yml` permissions). Subclass `helpers/base_test.py:BaseTest` (`create_group_and_model_with_bpmn`, `create_process_instance_from_process_model`, `logged_in_headers`, `app_config_mock`, …); load BPMN fixtures from `tests/data/<dir>` with `helpers/test_data.py:load_test_spec`.

## Frontend architecture (`spiffworkflow-frontend/src/`)

Pages in `views/` (routes in `views/BaseRoutes.tsx`), shared UI in `components/`, all API calls through `services/HttpService.ts` (`${BACKEND_BASE_URL}${path}`). The BPMN/DMN editor is `components/ReactDiagramEditor.tsx` on bpmn-js + `bpmn-js-spiffworkflow` (local wrapper in `packages/bpmn-js-spiffworkflow-react`). Task forms render with RJSF v6 (`rjsf/` custom widgets/templates, `components/CustomForm.tsx`); process-model "extensions" render through `ContainerForExtensions.tsx` / `views/Extension.tsx`.

`config.tsx` resolves settings from `window.spiffworkflowFrontendJsenv[KEY]`, then `VITE_<KEY>`. If `BACKEND_BASE_URL` is unset, it derives it from `APP_ROUTING_STRATEGY` (`subdomain_based` → `api.<host>`, `path_based` → `<host>/api`); on localhost it assumes backend port = frontend port − 1 (7001 → 7000).
