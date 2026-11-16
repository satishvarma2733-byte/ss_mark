# Load probe 2026-11-03T06:13:10.310Z

Base http://localhost:3100, 60s, 50 browsing sessions + 10 checkout customers (3 rounds each), think time 1000-3000 ms. LOCAL stack, MOCK provider.

| Request | Count | Errors | p50 ms | p95 ms | max ms |
| --- | --- | --- | --- | --- | --- |
| GET / (page) | 123 | 0 | 1332 | 4674 | 5032 |
| GET /api/v1/venues (search) | 115 | 0 | 2093 | 5780 | 6664 |
| GET /api/v1/venues/{id}/availability | 126 | 0 | 1931 | 5262 | 6408 |
| GET /api/v1/venues/{id} | 121 | 0 | 2082 | 5915 | 6563 |
| POST /quotes | 30 | 0 | 1346 | 8386 | 8412 |
| GET /venues/{slug} (page) | 126 | 0 | 7619 | 10199 | 10651 |
| POST /booking-holds | 30 | 0 | 3779 | 6966 | 8464 |
| POST /bookings/{id}/checkout | 30 | 0 | 8312 | 14948 | 14954 |
| POST /payment-orders/{id}/verify | 30 | 0 | 2909 | 6683 | 6696 |

Race for one table: 1 of 10 won; others: SLOT_UNAVAILABLE.
Invariants: overlapping active claims 0; confirmed bookings 30; captured but unallocated 0.
