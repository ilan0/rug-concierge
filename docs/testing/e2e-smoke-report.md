# E2E Smoke Report

- Generated: 2026-02-24T02:30:33.591Z
- Run ID: run-2026-02-24T02-30-28-338Z
- Base URL: http://127.0.0.1:3100
- Tenant ID: 0a175457-6194-4ae9-bf4e-1a785d754c4b
- Artifacts Root: /Users/ilannabatkhorian/Documents/rug-concierge/docs/testing/artifacts/run-2026-02-24t02-30-28-338z
- OpenAI Runtime: unknown (no AI recommendation traces in this run)
- Passed: 12
- Failed: 0

## Quick Summary

| Case | Status | Duration (ms) | AI Used | Fallback | Failed Checks | Endpoint |
| --- | --- | ---: | --- | --- | ---: | --- |
| recommend invalid json returns 400 | PASS | 35 | no | no | 0 | /api/recommend |
| recommend empty input returns 400 | PASS | 6 | no | no | 0 | /api/recommend |
| recommend missing tenant returns 400 | PASS | 5 | no | no | 0 | /api/recommend |
| recommend browse request returns contract | PASS | 580 | no | yes | 0 | /api/recommend |
| recommend constrained request returns contract | PASS | 450 | no | no | 0 | /api/recommend |
| recommend rejects invalid budget constraint | PASS | 11 | no | no | 0 | /api/recommend |
| recommend rejects invalid size constraint | PASS | 9 | no | no | 0 | /api/recommend |
| chat route returns session envelope | PASS | 920 | no | yes | 0 | /api/chat |
| chat route empty message returns 400 | PASS | 11 | no | no | 0 | /api/chat |
| chat trade context request returns recommendation envelope | PASS | 890 | no | yes | 0 | /api/chat |
| chat project room follow-up updates active room | PASS | 2325 | no | yes | 0 | /api/chat |
| appraisal endpoint blocks non-staff | PASS | 10 | no | no | 0 | /api/appraisal/generate |

## Results

### recommend invalid json returns 400
- Status: pass
- Duration: 35ms
- Endpoint: /api/recommend
- Method: POST
- AI Used: no
- AI Fallback Used: no
- Details: `{"error":"Invalid request","code":"BAD_REQUEST"}`
- Checks:
  - [PASS] status is 400 `{"expected":400,"actual":400}`
- Trace Files:
  - /Users/ilannabatkhorian/Documents/rug-concierge/docs/testing/artifacts/run-2026-02-24t02-30-28-338z/recommend-invalid-json-returns-400/recommend-route-30928669-f209-4697-bc18-2f16fd61e52a.json

#### High-Level
- Case ID: recommend-invalid-json-returns-400
- Function/flow observed: captured
- Supabase query info captured: no
- AI prompt captured: no
- AI response captured: no

#### Low-Level
##### Flow Paths

```json
[
  [
    "/api/recommend POST",
    "request_validation_failed"
  ]
]
```

##### Supabase Query Trace
- Not applicable or not reached for this case.

##### AI Request Payload
- Not applicable (no AI call for this case).

##### AI Raw Response
- Not applicable (no AI call for this case).

##### AI Parsed/Sanitized Response
- Not applicable (no AI call for this case).

### recommend empty input returns 400
- Status: pass
- Duration: 6ms
- Endpoint: /api/recommend
- Method: POST
- AI Used: no
- AI Fallback Used: no
- Details: `{"error":"Provide a message or at least one valid constraint (size and/or budget).","code":"BAD_REQUEST"}`
- Checks:
  - [PASS] status is 400 `{"expected":400,"actual":400}`
- Trace Files:
  - /Users/ilannabatkhorian/Documents/rug-concierge/docs/testing/artifacts/run-2026-02-24t02-30-28-338z/recommend-empty-input-returns-400/recommend-route-d8b45431-934d-4953-9438-7a7f4181458d.json

#### High-Level
- Case ID: recommend-empty-input-returns-400
- Function/flow observed: captured
- Supabase query info captured: no
- AI prompt captured: no
- AI response captured: no

#### Low-Level
##### Flow Paths

```json
[
  [
    "/api/recommend POST",
    "request_validation_failed"
  ]
]
```

##### Supabase Query Trace
- Not applicable or not reached for this case.

##### AI Request Payload
- Not applicable (no AI call for this case).

##### AI Raw Response
- Not applicable (no AI call for this case).

##### AI Parsed/Sanitized Response
- Not applicable (no AI call for this case).

### recommend missing tenant returns 400
- Status: pass
- Duration: 5ms
- Endpoint: /api/recommend
- Method: POST
- AI Used: no
- AI Fallback Used: no
- Details: `{"error":"tenant_id is required for recommendation requests.","code":"BAD_REQUEST"}`
- Checks:
  - [PASS] status is 400 `{"expected":400,"actual":400}`
- Trace Files:
  - /Users/ilannabatkhorian/Documents/rug-concierge/docs/testing/artifacts/run-2026-02-24t02-30-28-338z/recommend-missing-tenant-returns-400/recommend-route-eeeb9181-6d04-419d-8850-a3e23800ff7d.json

#### High-Level
- Case ID: recommend-missing-tenant-returns-400
- Function/flow observed: captured
- Supabase query info captured: no
- AI prompt captured: no
- AI response captured: no

#### Low-Level
##### Flow Paths

```json
[
  [
    "/api/recommend POST",
    "request_validation_failed"
  ]
]
```

##### Supabase Query Trace
- Not applicable or not reached for this case.

##### AI Request Payload
- Not applicable (no AI call for this case).

##### AI Raw Response
- Not applicable (no AI call for this case).

##### AI Parsed/Sanitized Response
- Not applicable (no AI call for this case).

### recommend browse request returns contract
- Status: pass
- Duration: 580ms
- Endpoint: /api/recommend
- Method: POST
- AI Used: no
- AI Fallback Used: yes
- Details: `{"response_body":{"mode":"recommendations","assistant_message":"Based on what you’re looking for, here are a few rugs that could work well:","questions":[],"recommendations":[{"rug_id":"a9fcb92c-1ae3-4caa-b35b-a95fa48fefff","sku":"15859","title":"Nomad Kilim","size_text":"34\" x 154\"","price_usd":219,"match_reasons":["Fits your current request in available inventory."],"confidence":0.47,"confidence_tier":"low","confidence_factors":[],"why_not":[]},{"rug_id":"710f98aa-1581-47d5-a1f7-2fcdfe6745fb`
- Checks:
  - [PASS] status is 200 or 500 `{"expected":[200,500],"actual":200}`
  - [PASS] mode is valid recommendation contract `{"actual":"recommendations"}`
- Trace Files:
  - /Users/ilannabatkhorian/Documents/rug-concierge/docs/testing/artifacts/run-2026-02-24t02-30-28-338z/recommend-browse-request-returns-contract/recommend-route-533e42c4-7284-4a7e-927e-501d96f473e8.json
  - /Users/ilannabatkhorian/Documents/rug-concierge/docs/testing/artifacts/run-2026-02-24t02-30-28-338z/recommend-browse-request-returns-contract/recommendation-pipeline-7c74149d-6b0e-4dc6-b21d-53b0a2455fed.json

#### High-Level
- Case ID: recommend-browse-request-returns-contract
- Function/flow observed: captured
- Supabase query info captured: yes
- AI prompt captured: no
- AI response captured: no

#### Low-Level
##### Flow Paths

```json
[
  [
    "/api/recommend POST",
    "runRecommendationPipeline"
  ],
  [
    "runRecommendationPipeline",
    "fetchInventoryCandidates",
    "filterByHardConstraints",
    "shapeCandidatesForAI",
    "rankAndExplain",
    "logRecommendationQaEvent"
  ]
]
```

##### Supabase Query Trace

```json
[
  {
    "variant": "none",
    "filters": {
      "tenant_id": "0a175457-6194-4ae9-bf4e-1a785d754c4b",
      "status": "available",
      "limit": 120,
      "size_bounds": null,
      "budget_max": null,
      "budget_field": null
    },
    "row_count": 10,
    "error": null
  }
]
```

##### AI Request Payload
- Not applicable (no AI call for this case).

##### AI Raw Response
- Not applicable (no AI call for this case).

##### AI Parsed/Sanitized Response
- Not applicable (no AI call for this case).

### recommend constrained request returns contract
- Status: pass
- Duration: 450ms
- Endpoint: /api/recommend
- Method: POST
- AI Used: no
- AI Fallback Used: no
- Details: `{"response_body":{"mode":"no_match","assistant_message":"Based on current inventory, nothing fits those constraints.","questions":["Would you like to adjust size or budget?"],"recommendations":[],"notes":null},"response_headers":{"recommendation_trace_id":"2fed0684-f35a-40ff-93b0-3e29ca6b08bb","recommend_route_trace_id":"0837b4c6-a6cf-4358-b61a-74930573f13e","chat_route_trace_id":null,"appraisal_trace_id":null}}`
- Checks:
  - [PASS] status is 200 or 500 `{"expected":[200,500],"actual":200}`
  - [PASS] mode is valid recommendation contract `{"actual":"no_match"}`
- Trace Files:
  - /Users/ilannabatkhorian/Documents/rug-concierge/docs/testing/artifacts/run-2026-02-24t02-30-28-338z/recommend-constrained-request-returns-contract/recommend-route-0837b4c6-a6cf-4358-b61a-74930573f13e.json
  - /Users/ilannabatkhorian/Documents/rug-concierge/docs/testing/artifacts/run-2026-02-24t02-30-28-338z/recommend-constrained-request-returns-contract/recommendation-pipeline-2fed0684-f35a-40ff-93b0-3e29ca6b08bb.json

#### High-Level
- Case ID: recommend-constrained-request-returns-contract
- Function/flow observed: captured
- Supabase query info captured: yes
- AI prompt captured: no
- AI response captured: no

#### Low-Level
##### Flow Paths

```json
[
  [
    "/api/recommend POST",
    "runRecommendationPipeline"
  ],
  [
    "runRecommendationPipeline",
    "fetchInventoryCandidates",
    "filterByHardConstraints",
    "shapeCandidatesForAI",
    "rankAndExplain",
    "logRecommendationQaEvent"
  ]
]
```

##### Supabase Query Trace

```json
[
  {
    "variant": "size_direct_budget_sale",
    "filters": {
      "tenant_id": "0a175457-6194-4ae9-bf4e-1a785d754c4b",
      "status": "available",
      "limit": 120,
      "size_bounds": {
        "min_width_in": 94,
        "max_width_in": 98,
        "min_length_in": 118,
        "max_length_in": 122,
        "rotated": false
      },
      "budget_max": 2500,
      "budget_field": "sale_price"
    },
    "row_count": 0,
    "error": null
  },
  {
    "variant": "size_rotated_budget_list",
    "filters": {
      "tenant_id": "0a175457-6194-4ae9-bf4e-1a785d754c4b",
      "status": "available",
      "limit": 120,
      "size_bounds": {
        "min_width_in": 94,
        "max_width_in": 98,
        "min_length_in": 118,
        "max_length_in": 122,
        "rotated": true
      },
      "budget_max": 2500,
      "budget_field": "price"
    },
    "row_count": 0,
    "error": null
  },
  {
    "variant": "size_direct_budget_list",
    "filters": {
      "tenant_id": "0a175457-6194-4ae9-bf4e-1a785d754c4b",
      "status": "available",
      "limit": 120,
      "size_bounds": {
        "min_width_in": 94,
        "max_width_in": 98,
        "min_length_in": 118,
        "max_length_in": 122,
        "rotated": false
      },
      "budget_max": 2500,
      "budget_field": "price"
    },
    "row_count": 0,
    "error": null
  },
  {
    "variant": "size_rotated_budget_sale",
    "filters": {
      "tenant_id": "0a175457-6194-4ae9-bf4e-1a785d754c4b",
      "status": "available",
      "limit": 120,
      "size_bounds": {
        "min_width_in": 94,
        "max_width_in": 98,
        "min_length_in": 118,
        "max_length_in": 122,
        "rotated": true
      },
      "budget_max": 2500,
      "budget_field": "sale_price"
    },
    "row_count": 0,
    "error": null
  }
]
```

##### AI Request Payload
- Not applicable (no AI call for this case).

##### AI Raw Response
- Not applicable (no AI call for this case).

##### AI Parsed/Sanitized Response
- Not applicable (no AI call for this case).

### recommend rejects invalid budget constraint
- Status: pass
- Duration: 11ms
- Endpoint: /api/recommend
- Method: POST
- AI Used: no
- AI Fallback Used: no
- Details: `{"error":"budgetMax must be a positive number.","code":"BAD_REQUEST"}`
- Checks:
  - [PASS] status is 400 `{"expected":400,"actual":400}`
- Trace Files:
  - /Users/ilannabatkhorian/Documents/rug-concierge/docs/testing/artifacts/run-2026-02-24t02-30-28-338z/recommend-rejects-invalid-budget-constraint/recommend-route-5c6aba88-1b44-427e-b6af-dce4ed1f0e31.json

#### High-Level
- Case ID: recommend-rejects-invalid-budget-constraint
- Function/flow observed: captured
- Supabase query info captured: no
- AI prompt captured: no
- AI response captured: no

#### Low-Level
##### Flow Paths

```json
[
  [
    "/api/recommend POST",
    "request_validation_failed"
  ]
]
```

##### Supabase Query Trace
- Not applicable or not reached for this case.

##### AI Request Payload
- Not applicable (no AI call for this case).

##### AI Raw Response
- Not applicable (no AI call for this case).

##### AI Parsed/Sanitized Response
- Not applicable (no AI call for this case).

### recommend rejects invalid size constraint
- Status: pass
- Duration: 9ms
- Endpoint: /api/recommend
- Method: POST
- AI Used: no
- AI Fallback Used: no
- Details: `{"error":"size widthIn/lengthIn must be positive numbers.","code":"BAD_REQUEST"}`
- Checks:
  - [PASS] status is 400 `{"expected":400,"actual":400}`
- Trace Files:
  - /Users/ilannabatkhorian/Documents/rug-concierge/docs/testing/artifacts/run-2026-02-24t02-30-28-338z/recommend-rejects-invalid-size-constraint/recommend-route-0ed98a80-4641-49b8-a2d0-ddf7d743dde0.json

#### High-Level
- Case ID: recommend-rejects-invalid-size-constraint
- Function/flow observed: captured
- Supabase query info captured: no
- AI prompt captured: no
- AI response captured: no

#### Low-Level
##### Flow Paths

```json
[
  [
    "/api/recommend POST",
    "request_validation_failed"
  ]
]
```

##### Supabase Query Trace
- Not applicable or not reached for this case.

##### AI Request Payload
- Not applicable (no AI call for this case).

##### AI Raw Response
- Not applicable (no AI call for this case).

##### AI Parsed/Sanitized Response
- Not applicable (no AI call for this case).

### chat route returns session envelope
- Status: pass
- Duration: 920ms
- Endpoint: /api/chat
- Method: POST
- AI Used: no
- AI Fallback Used: yes
- Details: `{"session_id":"c43fb306-8ce5-4947-b9fa-6f74281437a9","mode":"recommendation","response_headers":{"recommendation_trace_id":null,"recommend_route_trace_id":null,"chat_route_trace_id":"845797b0-984d-477b-b107-d78d03be3a8e","appraisal_trace_id":null}}`
- Checks:
  - [PASS] status is 200 `{"expected":200,"actual":200}`
  - [PASS] response contains session_id `{"actual":"c43fb306-8ce5-4947-b9fa-6f74281437a9"}`
  - [PASS] chat mode is valid `{"actual":"recommendation"}`
- Trace Files:
  - /Users/ilannabatkhorian/Documents/rug-concierge/docs/testing/artifacts/run-2026-02-24t02-30-28-338z/chat-route-returns-session-envelope/chat-route-845797b0-984d-477b-b107-d78d03be3a8e.json
  - /Users/ilannabatkhorian/Documents/rug-concierge/docs/testing/artifacts/run-2026-02-24t02-30-28-338z/chat-route-returns-session-envelope/recommendation-pipeline-a2dafc11-6906-4ec7-a28f-453333840e7a.json

#### High-Level
- Case ID: chat-route-returns-session-envelope
- Function/flow observed: captured
- Supabase query info captured: yes
- AI prompt captured: no
- AI response captured: no

#### Low-Level
##### Flow Paths

```json
[
  [
    "/api/chat POST",
    "getOrCreateSession",
    "updateRecommendationStateForTurn",
    "updateTradeContextForTurn",
    "updateProjectContextForTurn",
    "routeTurnMode",
    "handlerDispatch",
    "saveSession"
  ],
  [
    "runRecommendationPipeline",
    "fetchInventoryCandidates",
    "filterByHardConstraints",
    "shapeCandidatesForAI",
    "rankAndExplain",
    "logRecommendationQaEvent"
  ]
]
```

##### Supabase Query Trace

```json
[
  {
    "variant": "none",
    "filters": {
      "tenant_id": "0a175457-6194-4ae9-bf4e-1a785d754c4b",
      "status": "available",
      "limit": 120,
      "size_bounds": null,
      "budget_max": null,
      "budget_field": null
    },
    "row_count": 10,
    "error": null
  }
]
```

##### AI Request Payload
- Not applicable (no AI call for this case).

##### AI Raw Response
- Not applicable (no AI call for this case).

##### AI Parsed/Sanitized Response
- Not applicable (no AI call for this case).

### chat route empty message returns 400
- Status: pass
- Duration: 11ms
- Endpoint: /api/chat
- Method: POST
- AI Used: no
- AI Fallback Used: no
- Details: `{"error":"Please send a message so I can help.","code":"BAD_REQUEST"}`
- Checks:
  - [PASS] status is 400 `{"expected":400,"actual":400}`
- Trace Files:
  - (none)

#### High-Level
- Case ID: chat-route-empty-message-returns-400
- Function/flow observed: route-level only
- Supabase query info captured: no
- AI prompt captured: no
- AI response captured: no

#### Low-Level
##### Flow Paths
- No internal flow trace artifact captured.

##### Supabase Query Trace
- Not applicable or not reached for this case.

##### AI Request Payload
- Not applicable (no AI call for this case).

##### AI Raw Response
- Not applicable (no AI call for this case).

##### AI Parsed/Sanitized Response
- Not applicable (no AI call for this case).

### chat trade context request returns recommendation envelope
- Status: pass
- Duration: 890ms
- Endpoint: /api/chat
- Method: POST
- AI Used: no
- AI Fallback Used: yes
- Details: `{"role":"trade_client","mode":"recommendation","trade_context":{"tenant_id":"0a175457-6194-4ae9-bf4e-1a785d754c4b","trade_client_id":"trade-client-smoke","preferences":{"palette":"muted neutrals","style":"serapi"},"preferences_source":"request"},"response_headers":{"recommendation_trace_id":null,"recommend_route_trace_id":null,"chat_route_trace_id":"f71bec57-04dd-4f47-9023-fb24dd600a84","appraisal_trace_id":null}}`
- Checks:
  - [PASS] status is 200 `{"expected":200,"actual":200}`
  - [PASS] role echoes trade_client `{"actual":"trade_client"}`
  - [PASS] trade_context exists `{"actual":{"tenant_id":"0a175457-6194-4ae9-bf4e-1a785d754c4b","trade_client_id":"trade-client-smoke","preferences":{"palette":"muted neutrals","style":"serapi"},"preferences_source":"request"}}`
- Trace Files:
  - /Users/ilannabatkhorian/Documents/rug-concierge/docs/testing/artifacts/run-2026-02-24t02-30-28-338z/chat-trade-context-request-returns-recommendation-envelope/chat-route-f71bec57-04dd-4f47-9023-fb24dd600a84.json
  - /Users/ilannabatkhorian/Documents/rug-concierge/docs/testing/artifacts/run-2026-02-24t02-30-28-338z/chat-trade-context-request-returns-recommendation-envelope/recommendation-pipeline-dbb5a061-778a-4d2b-8d66-0373414db954.json

#### High-Level
- Case ID: chat-trade-context-request-returns-recommendation-envelope
- Function/flow observed: captured
- Supabase query info captured: yes
- AI prompt captured: no
- AI response captured: no

#### Low-Level
##### Flow Paths

```json
[
  [
    "/api/chat POST",
    "getOrCreateSession",
    "updateRecommendationStateForTurn",
    "updateTradeContextForTurn",
    "updateProjectContextForTurn",
    "routeTurnMode",
    "handlerDispatch",
    "saveSession"
  ],
  [
    "runRecommendationPipeline",
    "fetchInventoryCandidates",
    "filterByHardConstraints",
    "shapeCandidatesForAI",
    "rankAndExplain",
    "logRecommendationQaEvent"
  ]
]
```

##### Supabase Query Trace

```json
[
  {
    "variant": "none",
    "filters": {
      "tenant_id": "0a175457-6194-4ae9-bf4e-1a785d754c4b",
      "status": "available",
      "limit": 120,
      "size_bounds": null,
      "budget_max": null,
      "budget_field": null
    },
    "row_count": 10,
    "error": null
  }
]
```

##### AI Request Payload
- Not applicable (no AI call for this case).

##### AI Raw Response
- Not applicable (no AI call for this case).

##### AI Parsed/Sanitized Response
- Not applicable (no AI call for this case).

### chat project room follow-up updates active room
- Status: pass
- Duration: 2325ms
- Endpoint: /api/chat
- Method: POST
- AI Used: no
- AI Fallback Used: yes
- Details: `{"session_id":"388fbcb2-11fb-43bb-9126-150539aa4c9c","active_room_id":"dining_room","first_response_headers":{"recommendation_trace_id":null,"recommend_route_trace_id":null,"chat_route_trace_id":"eba5b833-c9b7-4329-b471-ffe160a0ef1d","appraisal_trace_id":null},"second_response_headers":{"recommendation_trace_id":null,"recommend_route_trace_id":null,"chat_route_trace_id":"7794fcf9-fc08-410f-b22d-cabf3aeb0b94","appraisal_trace_id":null}}`
- Checks:
  - [PASS] initial project call status is 200 `{"expected":200,"actual":200}`
  - [PASS] initial project call returns session_id `{"actual":"388fbcb2-11fb-43bb-9126-150539aa4c9c"}`
  - [PASS] follow-up project call status is 200 `{"expected":200,"actual":200}`
  - [PASS] active room is dining `{"actual":"dining_room"}`
- Trace Files:
  - /Users/ilannabatkhorian/Documents/rug-concierge/docs/testing/artifacts/run-2026-02-24t02-30-28-338z/chat-project-room-follow-up-updates-active-room/chat-route-7794fcf9-fc08-410f-b22d-cabf3aeb0b94.json
  - /Users/ilannabatkhorian/Documents/rug-concierge/docs/testing/artifacts/run-2026-02-24t02-30-28-338z/chat-project-room-follow-up-updates-active-room/chat-route-eba5b833-c9b7-4329-b471-ffe160a0ef1d.json
  - /Users/ilannabatkhorian/Documents/rug-concierge/docs/testing/artifacts/run-2026-02-24t02-30-28-338z/chat-project-room-follow-up-updates-active-room/recommendation-pipeline-4390377c-b053-4c8e-a962-49f3b87939a7.json
  - /Users/ilannabatkhorian/Documents/rug-concierge/docs/testing/artifacts/run-2026-02-24t02-30-28-338z/chat-project-room-follow-up-updates-active-room/recommendation-pipeline-6c5c050d-0346-4f5c-b074-c1c33973ed77.json

#### High-Level
- Case ID: chat-project-room-follow-up-updates-active-room
- Function/flow observed: captured
- Supabase query info captured: yes
- AI prompt captured: no
- AI response captured: no

#### Low-Level
##### Flow Paths

```json
[
  [
    "/api/chat POST",
    "getOrCreateSession",
    "updateRecommendationStateForTurn",
    "updateTradeContextForTurn",
    "updateProjectContextForTurn",
    "routeTurnMode",
    "handlerDispatch",
    "saveSession"
  ],
  [
    "/api/chat POST",
    "getOrCreateSession",
    "updateRecommendationStateForTurn",
    "updateTradeContextForTurn",
    "updateProjectContextForTurn",
    "routeTurnMode",
    "handlerDispatch",
    "saveSession"
  ],
  [
    "runRecommendationPipeline",
    "fetchInventoryCandidates",
    "filterByHardConstraints",
    "shapeCandidatesForAI",
    "rankAndExplain",
    "logRecommendationQaEvent"
  ],
  [
    "runRecommendationPipeline",
    "fetchInventoryCandidates",
    "filterByHardConstraints",
    "shapeCandidatesForAI",
    "rankAndExplain",
    "logRecommendationQaEvent"
  ]
]
```

##### Supabase Query Trace

```json
[
  {
    "variant": "budget_list",
    "filters": {
      "tenant_id": "0a175457-6194-4ae9-bf4e-1a785d754c4b",
      "status": "available",
      "limit": 120,
      "size_bounds": null,
      "budget_max": 2500,
      "budget_field": "price"
    },
    "row_count": 6,
    "error": null
  },
  {
    "variant": "budget_sale",
    "filters": {
      "tenant_id": "0a175457-6194-4ae9-bf4e-1a785d754c4b",
      "status": "available",
      "limit": 120,
      "size_bounds": null,
      "budget_max": 2500,
      "budget_field": "sale_price"
    },
    "row_count": 0,
    "error": null
  },
  {
    "variant": "none",
    "filters": {
      "tenant_id": "0a175457-6194-4ae9-bf4e-1a785d754c4b",
      "status": "available",
      "limit": 120,
      "size_bounds": null,
      "budget_max": null,
      "budget_field": null
    },
    "row_count": 10,
    "error": null
  }
]
```

##### AI Request Payload
- Not applicable (no AI call for this case).

##### AI Raw Response
- Not applicable (no AI call for this case).

##### AI Parsed/Sanitized Response
- Not applicable (no AI call for this case).

### appraisal endpoint blocks non-staff
- Status: pass
- Duration: 10ms
- Endpoint: /api/appraisal/generate
- Method: POST
- AI Used: no
- AI Fallback Used: no
- Details: `{"response_body":{"error":"Appraisal generation is available only for store staff or developer."},"response_headers":{"recommendation_trace_id":null,"recommend_route_trace_id":null,"chat_route_trace_id":null,"appraisal_trace_id":"624e796f-c892-42f4-9e47-a5490ae9feb5"}}`
- Checks:
  - [PASS] status is 403 `{"expected":403,"actual":403}`
- Trace Files:
  - /Users/ilannabatkhorian/Documents/rug-concierge/docs/testing/artifacts/run-2026-02-24t02-30-28-338z/appraisal-endpoint-blocks-non-staff/appraisal-route-624e796f-c892-42f4-9e47-a5490ae9feb5.json

#### High-Level
- Case ID: appraisal-endpoint-blocks-non-staff
- Function/flow observed: captured
- Supabase query info captured: no
- AI prompt captured: no
- AI response captured: no

#### Low-Level
##### Flow Paths

```json
[
  [
    "/api/appraisal/generate POST",
    "role_check_failed_non_staff_block"
  ]
]
```

##### Supabase Query Trace
- Not applicable or not reached for this case.

##### AI Request Payload
- Not applicable (no AI call for this case).

##### AI Raw Response
- Not applicable (no AI call for this case).

##### AI Parsed/Sanitized Response
- Not applicable (no AI call for this case).
