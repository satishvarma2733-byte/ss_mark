# Load probe 2026-11-03T06:21:08.575Z

Base http://localhost:3100, 60s, 50 browsing sessions + 10 checkout customers (3 rounds each), think time 1000-3000 ms, 12 tables on a 5-minute grid. LOCAL stack, MOCK provider.

| Request | Count | Errors | p50 ms | p95 ms | max ms |
| --- | --- | --- | --- | --- | --- |
| GET / (page) | 281 | 0 | 28 | 292 | 411 |
| GET /api/v1/venues (search) | 285 | 0 | 38 | 246 | 822 |
| GET /api/v1/venues/{id}/availability | 281 | 0 | 118 | 375 | 1064 |
| GET /api/v1/venues/{id} | 281 | 0 | 27 | 248 | 920 |
| GET /venues/{slug} (page) | 286 | 0 | 249 | 938 | 1545 |
| POST /quotes | 30 | 0 | 63 | 252 | 270 |
| POST /booking-holds | 30 | 0 | 45 | 80 | 152 |
| POST /bookings/{id}/checkout | 30 | 0 | 100 | 321 | 348 |
| POST /payment-orders/{id}/verify | 30 | 0 | 156 | 319 | 338 |

Race for one table: 1 of 10 won; others: SLOT_UNAVAILABLE.
Invariants: overlapping active claims 0; confirmed bookings 30; captured but unallocated 0.
