# Quality QA Report

Generated: 2026-03-10T01:54:17.820Z
Base URL: http://127.0.0.1:51818
Tenant ID: 1f3d032b-8411-48a9-8a44-1f3cb9df67a5
Cases: /Users/ilannabatkhorian/.codex/worktrees/post-merge-fixes/rug-concierge/scripts/testing/quality/chat-check.ndjson

| Scenario | Turn | Check | Status | Details |
| --- | --- | --- | --- | --- |
| general greeting stays in general_chat | 1 | status | PASS | {"expected":200,"actual":200} |
| general greeting stays in general_chat | 1 | mode | PASS | {"expected":"general_chat","actual":"general_chat"} |
| general greeting stays in general_chat | 1 | plain_text | PASS | {"assistant_message_plain":true,"recommendation_reasons_plain":true} |
| size request returns recommendation mode | 1 | status | PASS | {"expected":200,"actual":200} |
| size request returns recommendation mode | 1 | mode | PASS | {"expected":"recommendation","actual":"recommendation"} |
| size request returns recommendation mode | 1 | plain_text | PASS | {"assistant_message_plain":true,"recommendation_reasons_plain":true} |
| follow up remains plain text | 1 | status | PASS | {"expected":200,"actual":200} |
| follow up remains plain text | 1 | mode | PASS | {"expected":"recommendation","actual":"recommendation"} |
| follow up remains plain text | 1 | plain_text | PASS | {"assistant_message_plain":true,"recommendation_reasons_plain":true} |
| follow up remains plain text | 2 | status | PASS | {"expected":200,"actual":200} |
| follow up remains plain text | 2 | mode | PASS | {"expected":"recommendation","actual":"recommendation"} |
| follow up remains plain text | 2 | plain_text | PASS | {"assistant_message_plain":true,"recommendation_reasons_plain":true} |
