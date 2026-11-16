# Load probe 2026-11-03T06:11:39.328Z

Base http://localhost:3100, 45s, 50 browsing sessions + 10 checkout customers (3 rounds each). LOCAL stack, MOCK provider.

| Request | Count | Errors | p50 ms | p95 ms | max ms |
| --- | --- | --- | --- | --- | --- |
| GET / (page) | 108 | 0 | 731 | 5392 | 5508 |
| GET /api/v1/venues (search) | 91 | 0 | 3716 | 6288 | 8174 |
| GET /api/v1/venues/{id} | 99 | 0 | 3498 | 6628 | 8090 |
| GET /api/v1/venues/{id}/availability | 105 | 0 | 3172 | 6827 | 9332 |
| POST /quotes | 30 | 0 | 1693 | 6438 | 6566 |
| GET /venues/{slug} (page) | 115 | 0 | 11075 | 15047 | 16564 |
| POST /booking-holds | 30 | 0 | 2663 | 11489 | 11708 |
| POST /bookings/{id}/checkout | 30 | 0 | 146 | 24031 | 25684 |
| POST /payment-orders/{id}/verify | 30 | 0 | 101 | 10841 | 11165 |

Race for one table: 1 of 10 won; others: SLOT_UNAVAILABLE.
Invariants: overlapping active claims 0; confirmed bookings 30; captured but unallocated 0.
