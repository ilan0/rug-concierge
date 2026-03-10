# Functional QA Report

Generated: 2026-03-10T01:53:07.749Z
Base URL: http://127.0.0.1:51805
Tenant ID: 1f3d032b-8411-48a9-8a44-1f3cb9df67a5

| Check | Status | Details |
| --- | --- | --- |
| chat endpoint returns 200 for greeting | PASS | {"endpoint":"/api/chat","status":200} |
| recommendation turn returns 200 with plain text reasons | PASS | {"endpoint":"/api/chat","status":200,"recommendation_count":1} |
| public config endpoint returns 200 | PASS | {"endpoint":"/api/config/public","status":200} |
| manifest endpoint returns JSON manifest | PASS | {"endpoint":"/api/manifest","status":200,"content_type":"application/manifest+json"} |
| session reset returns new UUID | PASS | {"endpoint":"/api/session/reset","status":200} |
| passcode endpoint is callable | PASS | {"endpoint":"/api/auth/passcode","status":404} |
