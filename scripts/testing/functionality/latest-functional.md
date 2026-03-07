# Functionality Suite (Latest)

- Generated: 2026-03-06T21:40:53.456Z
- Base URL: http://127.0.0.1:58789
- Tenant ID: 0a175457-6194-4ae9-bf4e-1a785d754c4b
- Passed: 23
- Failed: 0

| Check | Result | Details |
| --- | --- | --- |
| chat endpoint returns 200 + valid envelope | PASS | {"endpoint":"/api/chat","status":200,"debug":{"chat_route_trace_id":null,"recommendation_trace_id":null,"appraisal_trace_id":null}} |
| recommend endpoint returns 200 + valid envelope | PASS | {"endpoint":"/api/recommend","status":200,"debug":{"chat_route_trace_id":null,"recommendation_trace_id":null,"appraisal_trace_id":null}} |
| appraisal endpoint allows staff and returns structured JSON | PASS | {"endpoint":"/api/appraisal/generate","status":200,"debug":{"chat_route_trace_id":null,"recommendation_trace_id":null,"appraisal_trace_id":null}} |
| inventory-linked appraisal without rug_id fails safely (400, no 500) | PASS | {"endpoint":"/api/appraisal/generate","status":400,"debug":{"chat_route_trace_id":null,"recommendation_trace_id":null,"appraisal_trace_id":null}} |
| appraisal endpoint blocks retail (403, no 500) | PASS | {"endpoint":"/api/appraisal/generate","status":403,"debug":{"chat_route_trace_id":null,"recommendation_trace_id":null,"appraisal_trace_id":null}} |
| role mismatch is rejected (403, no 500) | PASS | {"endpoint":"/api/chat","status":403,"debug":{"chat_route_trace_id":null,"recommendation_trace_id":null,"appraisal_trace_id":null}} |
| chat appraisal-like request remains general chat mode | PASS | {"endpoint":"/api/chat","status":200,"debug":{"chat_route_trace_id":null,"recommendation_trace_id":null,"appraisal_trace_id":null}} |
| tenant mismatch on existing session is rejected (403) | PASS | {"endpoint":"/api/chat","status":403,"session_id_present":true,"debug":{"chat_route_trace_id":null,"recommendation_trace_id":null,"appraisal_trace_id":null}} |
| recommend missing tenant returns 400 (no 500) | PASS | {"endpoint":"/api/recommend","status":400,"debug":{"chat_route_trace_id":null,"recommendation_trace_id":null,"appraisal_trace_id":null}} |
| inventory intake happy path returns 200 and rug envelope | PASS | {"endpoint":"/api/inventory/intake","status":200,"debug":{"intake_trace_id":"f642b802-1688-4976-bd2e-0803da65990d"}} |
| inventory intake missing image fails validation (400) | PASS | {"endpoint":"/api/inventory/intake","status":400,"debug":{"intake_trace_id":"28236623-8418-470e-8f3f-91a370ca2a3e"}} |
| inventory intake rejects invalid inch ranges (400) | PASS | {"endpoint":"/api/inventory/intake","status":400,"debug":{"intake_trace_id":"481f3cf4-65c0-49f2-81ff-2d3dfe4faeb8"}} |
| inventory intake requires tenant context (400) | PASS | {"endpoint":"/api/inventory/intake","status":400,"debug":{"intake_trace_id":"09a40b69-4e53-4756-936b-bb92a9188d63"}} |
| inventory intake role mismatch rejected (403) | PASS | {"endpoint":"/api/inventory/intake","status":403,"debug":{"intake_trace_id":"2f3234d9-3782-4da6-a903-84b76c638e45"}} |
| appraisal rugs lookup allows staff and returns rows envelope | PASS | {"endpoint":"/api/appraisal/rugs?tenant_id=0a175457-6194-4ae9-bf4e-1a785d754c4b&role=store_staff&limit=5","status":200,"debug":{"chat_route_trace_id":null,"recommendation_trace_id":null,"appraisal_trace_id":null}} |
| appraisal rugs lookup blocks retail (403, no 500) | PASS | {"endpoint":"/api/appraisal/rugs?tenant_id=0a175457-6194-4ae9-bf4e-1a785d754c4b&role=retail_customer&limit=5","status":403,"debug":{"chat_route_trace_id":null,"recommendation_trace_id":null,"appraisal_trace_id":null}} |
| appraisal drafts save rejects inaccessible appraisal_id (403, no cross-tenant overwrite) | PASS | {"endpoint":"/api/appraisal/drafts","status":403,"debug":{"chat_route_trace_id":null,"recommendation_trace_id":null,"appraisal_trace_id":null}} |
| appraisal generate rejects inaccessible appraisal_id (403, no cross-tenant overwrite) | PASS | {"endpoint":"/api/appraisal/generate","status":403,"debug":{"chat_route_trace_id":null,"recommendation_trace_id":null,"appraisal_trace_id":null}} |
| appraisal drafts save allows staff and returns persistence envelope | PASS | {"endpoint":"/api/appraisal/drafts","status":200,"debug":{"chat_route_trace_id":null,"recommendation_trace_id":null,"appraisal_trace_id":null}} |
| appraisal draft can be finalized by staff | PASS | {"endpoint":"/api/appraisal/drafts","status":200,"appraisal_id_present":true,"debug":{"chat_route_trace_id":null,"recommendation_trace_id":null,"appraisal_trace_id":null}} |
| finalized appraisal cannot be regenerated | PASS | {"endpoint":"/api/appraisal/generate","status":403,"appraisal_id_present":true,"debug":{"chat_route_trace_id":null,"recommendation_trace_id":null,"appraisal_trace_id":null}} |
| finalized appraisal cannot be modified via drafts save | PASS | {"endpoint":"/api/appraisal/drafts","status":403,"appraisal_id_present":true,"debug":{"chat_route_trace_id":null,"recommendation_trace_id":null,"appraisal_trace_id":null}} |
| appraisal drafts list allows staff and returns rows envelope | PASS | {"endpoint":"/api/appraisal/drafts?tenant_id=0a175457-6194-4ae9-bf4e-1a785d754c4b&role=store_staff&limit=5","status":200,"debug":{"chat_route_trace_id":null,"recommendation_trace_id":null,"appraisal_trace_id":null}} |
