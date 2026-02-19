# E2E Smoke Report

- Generated: 2026-02-19T02:07:49.204Z
- Base URL: http://localhost:3000
- Tenant ID: (not provided)
- Passed: 11
- Failed: 0

## Results

### recommend invalid json returns 400
- Status: pass
- Duration: 38ms
- Details: `{"error":"Invalid request","code":"BAD_REQUEST"}`

### recommend empty input returns 400
- Status: pass
- Duration: 7ms
- Details: `{"error":"Provide a message or at least one valid constraint (size and/or budget).","code":"BAD_REQUEST"}`

### recommend browse request returns contract
- Status: pass
- Duration: 483ms
- Details: `{"mode":"recommendations","assistant_message":"Based on what you’re looking for, here are a few rugs that could work well:","questions":[],"recommendations":[{"rug_id":"a9fcb92c-1ae3-4caa-b35b-a95fa48fefff","sku":"15859","title":"Nomad Kilim","size_text":"34\" x 154\"","price_usd":219,"match_reasons":["Fits your current request in available inventory."],"confidence":0.47,"confidence_tier":"low","confidence_factors":[],"why_not":[]},{"rug_id":"f1a7f328-6fd9-48fa-80b8-462a19177c36","sku":"B-75750"`

### recommend constrained request returns contract
- Status: pass
- Duration: 422ms
- Details: `{"mode":"recommendations","assistant_message":"Based on what you’re looking for, here are a few rugs that could work well:","questions":[],"recommendations":[{"rug_id":"f1a7f328-6fd9-48fa-80b8-462a19177c36","sku":"B-75750","title":"8' x 10' New Serapi Rug Dark Blue","size_text":"96\" x 120\"","price_usd":950,"match_reasons":["Size closely matches your requested dimensions.","Priced at $950, within your budget limit."],"confidence":0.82,"confidence_tier":"high","confidence_factors":["Strong size `

### recommend rejects invalid budget constraint
- Status: pass
- Duration: 5ms
- Details: `{"error":"budgetMax must be a positive number.","code":"BAD_REQUEST"}`

### recommend rejects invalid size constraint
- Status: pass
- Duration: 5ms
- Details: `{"error":"size widthIn/lengthIn must be positive numbers.","code":"BAD_REQUEST"}`

### chat route returns session envelope
- Status: pass
- Duration: 279ms
- Details: `{"session_id":"a36a1f3c-b455-480b-953d-7bf8ac131ae4","mode":"recommendation"}`

### chat route empty message returns 400
- Status: pass
- Duration: 8ms
- Details: `{"error":"Please send a message so I can help.","code":"BAD_REQUEST"}`

### chat trade context request returns recommendation envelope
- Status: pass
- Duration: 186ms
- Details: `{"role":"trade_client","mode":"recommendation","trade_context":{"tenant_id":null,"trade_client_id":"trade-client-smoke","preferences":{"palette":"muted neutrals","style":"serapi"},"preferences_source":"request"}}`

### chat project room follow-up updates active room
- Status: pass
- Duration: 596ms
- Details: `{"session_id":"2c8d0a24-45e7-412f-a7a3-0fab5c1c822e","active_room_id":"dining_room"}`

### appraisal endpoint blocks non-staff
- Status: pass
- Duration: 9ms
- Details: `{"error":"Appraisal generation is available only for store staff."}`
