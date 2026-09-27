-- Runs once, only against a fresh (empty) `neuronest-pgdata` volume — the official
-- postgres image executes everything in /docker-entrypoint-initdb.d on first init only.
-- `POSTGRES_DB` (docker-compose.yml) provisions the dev/default `neuronest` database;
-- this provisions the separate throwaway database `TEST_DATABASE_URL` points at
-- (see docs/database-and-docker.md §3 — Dual Database Architecture), so a fresh
-- `npm run docker:up` works without a manual `CREATE DATABASE` step.
CREATE DATABASE neuronest_test;
