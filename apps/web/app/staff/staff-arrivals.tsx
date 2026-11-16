"use client";

// Staff arrival desk. Codes are verified by the database; this screen never learns whether a wrong code belongs to
// another booking. The camera starts only after "Scan QR" and manual reference + PIN always works.
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { CheckInResult, StaffArrivals as Arrivals } from "@simply-sit/contracts";
import { apiCall, newIdempotencyKey } from "../../lib/client-api";
import { formatVenueTime } from "../../lib/format";
import { TableScroll } from "../../lib/table-scroll";
import { Button, Card } from "../../components/ui";

type BarcodeDetectorLike = { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> };
declare global {
  interface Window {
    BarcodeDetector?: new (options: { formats: string[] }) => BarcodeDetectorLike;
  }
}

const NOT_OPEN: Record<string, string> = {
  too_early: "Check-in opens 15 minutes before the start time.",
  grace_elapsed: "The arrival window has passed. Handle this as a late arrival with your manager.",
  previous_booking: "The table is still reserved for an earlier booking. Ask the guest to wait until their start time."
};

export function StaffArrivals({ venueId }: { venueId: string }) {
  const [data, setData] = useState<Arrivals | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ref, setRef] = useState("SS-");
  const [pin, setPin] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ tone: string; text: string } | null>(null);
  const [scanning, setScanning] = useState(false);
  const video = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);

  const load = useCallback(async () => {
    const response = await apiCall<Arrivals>("GET", `/api/v1/partner/arrivals?venue_id=${venueId}`);
    if (response.ok) {
      setData(response.data);
      setLoadError(null);
    } else setLoadError(response.message);
  }, [venueId]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const stopCamera = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setScanning(false);
  }, []);
  useEffect(() => stopCamera, [stopCamera]);

  async function submitCheckIn(body: Record<string, string>) {
    setBusy("check-in");
    setResult(null);
    const response = await apiCall<CheckInResult>("POST", "/api/v1/partner/check-in", {
      idempotencyKey: newIdempotencyKey(),
      body: { venue_id: venueId, ...body }
    });
    setBusy(null);
    if (response.ok) {
      const r = response.data;
      setResult({
        tone: "status-success",
        text: `${r.outcome === "ALREADY_CHECKED_IN" ? "Already checked in" : "Checked in"}: ${r.public_ref}, ${r.table_label}, party of ${r.party_size}.`
      });
      setPin("");
      setToken("");
      setRef("SS-");
    } else if (response.code === "CHECK_IN_NOT_OPEN") {
      setResult({ tone: "status-warning", text: NOT_OPEN[String(response.details?.reason)] ?? response.message });
    } else if (response.code === "TABLE_NOT_READY") {
      setResult({ tone: "status-warning", text: "The table is not marked ready. Finish cleaning and mark it ready first." });
    } else {
      setResult({ tone: "status-error", text: response.message });
    }
    await load();
  }

  function onManual(event: FormEvent) {
    event.preventDefault();
    void submitCheckIn({ public_ref: ref.trim().toUpperCase(), pin });
  }
  function onToken(event: FormEvent) {
    event.preventDefault();
    void submitCheckIn({ qr_token: token.trim() });
  }

  async function startScan() {
    setResult(null);
    if (!window.BarcodeDetector || !navigator.mediaDevices?.getUserMedia) {
      setResult({ tone: "status-warning", text: "QR scanning is not available in this browser. Enter the reference and PIN instead." });
      return;
    }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    } catch {
      setResult({ tone: "status-warning", text: "Camera access was not allowed. Enter the reference and PIN instead." });
      return;
    }
    setScanning(true);
    const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
    requestAnimationFrame(async function tick() {
      if (!stream.current || !video.current) return;
      if (video.current.srcObject !== stream.current) {
        video.current.srcObject = stream.current;
        await video.current.play().catch(() => undefined);
      }
      const codes = await detector.detect(video.current).catch(() => []);
      const value = codes[0]?.rawValue;
      if (value) {
        stopCamera();
        void submitCheckIn({ qr_token: value });
        return;
      }
      requestAnimationFrame(tick);
    });
  }

  async function checkOut(bookingId: string, version: number) {
    setBusy(bookingId);
    const response = await apiCall("POST", `/api/v1/partner/bookings/${bookingId}/check-out`, {
      idempotencyKey: newIdempotencyKey(),
      body: { expected_version: version }
    });
    setBusy(null);
    setResult(response.ok ? { tone: "status-success", text: "Checked out. The table is now marked for cleaning." } : { tone: "status-error", text: response.message });
    await load();
  }

  async function markReady(resourceId: string, version: number) {
    setBusy(resourceId);
    const response = await apiCall("POST", `/api/v1/partner/resources/${resourceId}/ready`, {
      idempotencyKey: newIdempotencyKey(),
      body: { expected_version: version }
    });
    setBusy(null);
    setResult(response.ok ? { tone: "status-success", text: "Table marked ready." } : { tone: "status-error", text: response.message });
    await load();
  }

  const tz = data?.timezone ?? "Asia/Kolkata";
  return (
    <>
      <Card aria-labelledby="checkin-heading">
        <h2 id="checkin-heading">Check in a guest</h2>
        <form onSubmit={onManual} className="field-row" aria-label="Check in with reference and PIN">
          <div>
            <label htmlFor="ref">Booking reference</label>
            <input id="ref" className="input" value={ref} onChange={(e) => setRef(e.target.value)} autoComplete="off" spellCheck={false}
              inputMode="text" maxLength={13} required />
          </div>
          <div>
            <label htmlFor="pin">PIN</label>
            <input id="pin" className="input" value={pin} onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric"
              autoComplete="off" pattern="[0-9]{6}" maxLength={6} required />
          </div>
          <div style={{ alignSelf: "end" }}>
            <Button type="submit" disabled={busy !== null} aria-busy={busy === "check-in"} data-testid="check-in-pin">
              Check in
            </Button>
          </div>
        </form>
        <details>
          <summary>Scan or paste a QR code</summary>
          <p>
            <Button variant="secondary" type="button" onClick={() => (scanning ? stopCamera() : void startScan())}>
              {scanning ? "Stop camera" : "Scan QR"}
            </Button>
          </p>
          {scanning ? <video ref={video} muted playsInline className="scanner" aria-label="Camera preview for QR scanning" /> : null}
          <form onSubmit={onToken} className="field-row" aria-label="Check in with QR code text">
            <div>
              <label htmlFor="token">QR code text</label>
              <input id="token" className="input" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} />
            </div>
            <div style={{ alignSelf: "end" }}>
              <Button variant="secondary" type="submit" disabled={busy !== null || token.length < 20} data-testid="check-in-token">
                Check in with code
              </Button>
            </div>
          </form>
        </details>
        {result ? (
          <p className={result.tone} role="status" aria-live="polite" data-testid="check-in-result">
            {result.text}
          </p>
        ) : null}
      </Card>

      {loadError ? (
        <p className="notice status-error" role="alert">
          {loadError}
        </p>
      ) : null}

      <section aria-labelledby="today-heading">
        <h2 id="today-heading">Today ({data?.date ?? "..."})</h2>
        {data && data.bookings.length === 0 ? <p className="notice">No confirmed bookings today.</p> : null}
        {data && data.bookings.length > 0 ? (
          <TableScroll label="Arrivals">
            <table>
              <thead>
                <tr>
                  <th scope="col">Time (IST)</th>
                  <th scope="col">Reference</th>
                  <th scope="col">Table</th>
                  <th scope="col">Party</th>
                  <th scope="col">State</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.bookings.map((b) => (
                  <tr key={b.booking_id} data-testid={`arrival-${b.public_ref}`}>
                    <td>
                      {formatVenueTime(b.start_at, tz)}-{formatVenueTime(b.end_at, tz)}
                    </td>
                    <td>{b.public_ref}</td>
                    <td>{b.table_label}</td>
                    <td>{b.party_size}</td>
                    <td>{b.status === "CHECKED_IN" ? "Checked in" : b.status === "COMPLETED" ? "Checked out" : b.status === "NO_SHOW" ? "No-show" : "Expected"}</td>
                    <td>
                      {b.status === "CHECKED_IN" ? (
                        <Button variant="secondary" type="button" disabled={busy !== null} onClick={() => void checkOut(b.booking_id, b.version)}
                          data-testid={`check-out-${b.public_ref}`}>
                          Check out
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        ) : null}
      </section>

      <section aria-labelledby="tables-heading">
        <h2 id="tables-heading">Tables</h2>
        <ul className="grid result-list">
          {data?.tables.map((t) => (
            <li key={t.resource_id}>
              <Card as="article" data-testid={`table-${t.label}`}>
                <h3>{t.label}</h3>
                <p className={t.operational_state === "READY" ? "status-success" : "status-warning"}>
                  {t.operational_state === "READY" ? "Ready" : t.operational_state === "CLEANING" ? "Needs cleaning" : t.operational_state === "OCCUPIED" ? "Occupied" : "Out of service"}
                </p>
                {t.operational_state === "CLEANING" ? (
                  <Button type="button" disabled={busy !== null} onClick={() => void markReady(t.resource_id, t.version)}
                    data-testid={`ready-${t.label}`}>
                    Mark ready
                  </Button>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
