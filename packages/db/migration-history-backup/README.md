# Migration History Backup

`2026-03-15-pre-rewrite/` contains a snapshot of migration SQL files as they existed before the history rewrite pass.

Purpose:
- preserve pre-rewrite text for audit/debug,
- keep a durable reference for environments that had already applied older migration text.

Important:
- this backup is documentation only,
- production databases should **not** re-run rewritten historical migrations,
- rewritten history is intended for deterministic fresh-environment setup going forward.

