# Load probe 2026-11-03T06:19:45.671Z

Base http://localhost:3100, 60s, 50 browsing sessions + 10 checkout customers (3 rounds each), think time 1000-3000 ms, 12 tables on a 30-minute grid. LOCAL stack, MOCK provider.

| Request | Count | Errors | p50 ms | p95 ms | max ms |
| --- | --- | --- | --- | --- | --- |
| GET / (page) | 292 | 0 | 39 | 373 | 604 |
| GET /api/v1/venues/{id}/availability | 294 | 0 | 47 | 551 | 1042 |
| GET /api/v1/venues (search) | 286 | 0 | 35 | 683 | 1422 |
| GET /api/v1/venues/{id} | 292 | 0 | 31 | 426 | 1529 |
| GET /venues/{slug} (page) | 286 | 0 | 153 | 926 | 1529 |
| POST /quotes | 30 | 0 | 51 | 560 | 564 |
| POST /booking-holds | 30 | 0 | 44 | 416 | 442 |
| POST /bookings/{id}/checkout | 30 | 0 | 116 | 1159 | 1169 |
| POST /payment-orders/{id}/verify | 30 | 0 | 87 | 590 | 619 |

Race for one table: 1 of 10 won; others: SLOT_UNAVAILABLE.
Invariants: overlapping active claims 0; confirmed bookings 30; captured but unallocated 0.
