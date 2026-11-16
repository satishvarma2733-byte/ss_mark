# Load probe 2026-11-03T06:22:27.614Z

Base http://localhost:3100, 45s, 50 browsing sessions + 10 checkout customers (3 rounds each), think time 0-0 ms, 12 tables on a 30-minute grid. LOCAL stack, MOCK provider.

| Request | Count | Errors | p50 ms | p95 ms | max ms |
| --- | --- | --- | --- | --- | --- |
| GET / (page) | 412 | 0 | 298 | 674 | 1316 |
| GET /api/v1/venues/{id}/availability | 405 | 0 | 950 | 1696 | 1963 |
| GET /api/v1/venues (search) | 394 | 0 | 921 | 1695 | 2022 |
| GET /api/v1/venues/{id} | 406 | 0 | 993 | 1777 | 2180 |
| POST /quotes | 30 | 0 | 994 | 1609 | 1707 |
| GET /venues/{slug} (page) | 413 | 0 | 1978 | 3639 | 4225 |
| POST /booking-holds | 30 | 0 | 1805 | 2445 | 2583 |
| POST /bookings/{id}/checkout | 30 | 0 | 6832 | 8008 | 8329 |
| POST /payment-orders/{id}/verify | 30 | 0 | 3951 | 4286 | 4477 |

Race for one table: 1 of 10 won; others: SLOT_UNAVAILABLE.
Invariants: overlapping active claims 0; confirmed bookings 30; captured but unallocated 0.
