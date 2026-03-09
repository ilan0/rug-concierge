# Functionality Suite (Latest)

- Generated: 2026-03-08T01:35:31.511Z
- Base URL: http://127.0.0.1:62250
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
| inventory intake happy path returns 200 and rug envelope | PASS | {"endpoint":"/api/inventory/intake","status":200,"debug":{"intake_trace_id":"955f6763-e175-4576-9296-ffb0a9739bb9"}} |
| inventory intake missing image fails validation (400) | PASS | {"endpoint":"/api/inventory/intake","status":400,"debug":{"intake_trace_id":"a6ccdd4f-5340-4d18-b395-a68b405860fb"}} |
| inventory intake rejects invalid inch ranges (400) | PASS | {"endpoint":"/api/inventory/intake","status":400,"debug":{"intake_trace_id":"3e59b481-e3ce-4b19-975a-cee5f5e106b4"}} |
| inventory intake requires tenant context (400) | PASS | {"endpoint":"/api/inventory/intake","status":400,"debug":{"intake_trace_id":"574accaf-3e6f-404a-b443-bc6f23f89063"}} |
| inventory intake role mismatch rejected (403) | PASS | {"endpoint":"/api/inventory/intake","status":403,"debug":{"intake_trace_id":"3fc0e219-8b02-4289-83ed-c5bb1c4f33cb"}} |
| appraisal rugs lookup allows staff and returns rows envelope | PASS | {"endpoint":"/api/appraisal/rugs?tenant_id=0a175457-6194-4ae9-bf4e-1a785d754c4b&role=store_staff&limit=5","status":200,"debug":{"chat_route_trace_id":null,"recommendation_trace_id":null,"appraisal_trace_id":null}} |
| appraisal rugs lookup blocks retail (403, no 500) | PASS | {"endpoint":"/api/appraisal/rugs?tenant_id=0a175457-6194-4ae9-bf4e-1a785d754c4b&role=retail_customer&limit=5","status":403,"debug":{"chat_route_trace_id":null,"recommendation_trace_id":null,"appraisal_trace_id":null}} |
| appraisal drafts save rejects inaccessible appraisal_id (403, no cross-tenant overwrite) | PASS | {"endpoint":"/api/appraisal/drafts","status":403,"debug":{"chat_route_trace_id":null,"recommendation_trace_id":null,"appraisal_trace_id":null}} |
| appraisal generate rejects inaccessible appraisal_id (403, no cross-tenant overwrite) | PASS | {"endpoint":"/api/appraisal/generate","status":403,"debug":{"chat_route_trace_id":null,"recommendation_trace_id":null,"appraisal_trace_id":null}} |
| appraisal drafts save allows staff and returns persistence envelope | PASS | {"endpoint":"/api/appraisal/drafts","status":200,"debug":{"chat_route_trace_id":null,"recommendation_trace_id":null,"appraisal_trace_id":null}} |
| appraisal draft can be finalized by staff | PASS | {"endpoint":"/api/appraisal/drafts","status":200,"appraisal_id_present":true,"debug":{"chat_route_trace_id":null,"recommendation_trace_id":null,"appraisal_trace_id":null}} |
| finalized appraisal cannot be regenerated | PASS | {"endpoint":"/api/appraisal/generate","status":403,"appraisal_id_present":true,"debug":{"chat_route_trace_id":null,"recommendation_trace_id":null,"appraisal_trace_id":null}} |
| finalized appraisal cannot be modified via drafts save | PASS | {"endpoint":"/api/appraisal/drafts","status":403,"appraisal_id_present":true,"debug":{"chat_route_trace_id":null,"recommendation_trace_id":null,"appraisal_trace_id":null}} |
| appraisal drafts list allows staff and returns rows envelope | PASS | {"endpoint":"/api/appraisal/drafts?tenant_id=0a175457-6194-4ae9-bf4e-1a785d754c4b&role=store_staff&limit=5","status":200,"debug":{"chat_route_trace_id":null,"recommendation_trace_id":null,"appraisal_trace_id":null}} |
