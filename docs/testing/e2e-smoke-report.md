# E2E Smoke Report

- Generated: 2026-02-15T00:27:24.718Z
- Base URL: http://localhost:3000
- Tenant ID: (not provided)
- Passed: 4
- Failed: 0

## Results

### recommend invalid json returns 400
- Status: pass
- Duration: 32ms
- Details: `{"error":"Invalid request"}`

### recommend browse request returns contract
- Status: pass
- Duration: 156ms
- Details: `{"mode":"recommendations","assistant_message":"Based on what you’re looking for, here are a few rugs that could work well:","questions":[],"recommendations":[{"rug_id":"a9fcb92c-1ae3-4caa-b35b-a95fa48fefff","sku":"15859","title":"Nomad Kilim","size_text":"34\" x 154\"","price_usd":219,"match_reasons":["Fits your current request in available inventory."],"confidence":0.55},{"rug_id":"f1a7f328-6fd9-48fa-80b8-462a19177c36","sku":"B-75750","title":"8' x 10' New Serapi Rug Dark Blue","size_text":"96\`

### recommend constrained request returns contract
- Status: pass
- Duration: 291ms
- Details: `{"mode":"recommendations","assistant_message":"Based on what you’re looking for, here are a few rugs that could work well:","questions":[],"recommendations":[{"rug_id":"f1a7f328-6fd9-48fa-80b8-462a19177c36","sku":"B-75750","title":"8' x 10' New Serapi Rug Dark Blue","size_text":"96\" x 120\"","price_usd":950,"match_reasons":["Fits your current request in available inventory."],"confidence":0.55},{"rug_id":"bf63999b-884b-4893-a007-62b58fcf2816","sku":"B-75731","title":"8' x 10' Serapi Handmade Ru`

### chat route returns session envelope
- Status: pass
- Duration: 70ms
- Details: `{"session_id":"1d908552-579c-4ca3-abf0-b5ba4948a8bd","mode":"recommendation"}`
