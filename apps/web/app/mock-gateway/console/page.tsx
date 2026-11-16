import { formatInrPaise } from "../../../lib/format";
import { mockGatewayOrNotFound } from "../../../lib/mock-gateway";
import { Button, Card } from "../../../components/ui";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  order_id: string;
  amount_paise: number;
  currency: string;
  status: string;
  created_at: Date;
  webhooks: { id: string; event_type: string; deliveries: number; last_http_status: number | null }[] | null;
};

// Tester console for the local mock provider: delayed or duplicate webhooks, late captures and injected faults.
export default async function MockGatewayConsole() {
  const gateway = mockGatewayOrNotFound();
  const payments = (await gateway.recentPayments(30)) as unknown as Row[];
  return (
    <main className="mock-gateway">
      <p className="mock-gateway-banner" role="note">
        MOCK PAYMENT GATEWAY CONSOLE - TEST MODE - NO MONEY MOVES
      </p>
      <h1>Mock gateway console</h1>
      <Card aria-labelledby="faults">
        <h2 id="faults">Inject a fault</h2>
        <form method="post" action="/mock-gateway/console/action" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <input type="hidden" name="action" value="faults" />
          <label htmlFor="create_order">Order creation</label>
          <select id="create_order" name="create_order" className="input" style={{ maxWidth: 320 }} defaultValue="">
            <option value="">Normal</option>
            <option value="unavailable">Provider unavailable (refused)</option>
            <option value="timeout_after_create">Timeout after creating (outcome unknown)</option>
          </select>
          <Button variant="secondary" type="submit">
            Apply
          </Button>
        </form>
      </Card>
      <h2>Recent mock payments</h2>
      {payments.length === 0 ? <p className="notice">No mock payments yet.</p> : null}
      <table>
        <thead>
          <tr>
            <th scope="col">Payment</th>
            <th scope="col">Amount</th>
            <th scope="col">State</th>
            <th scope="col">Webhooks</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.id} data-testid={`mock-payment-${p.id}`}>
              <td>
                {p.id}
                <br />
                <small>{p.order_id}</small>
              </td>
              <td>
                {p.currency === "INR" ? formatInrPaise(Number(p.amount_paise)) : `${p.amount_paise} ${p.currency}`}
              </td>
              <td>{p.status}</td>
              <td>
                {(p.webhooks ?? []).map((w) => (
                  <div key={w.id}>
                    {w.event_type} x{w.deliveries} {w.last_http_status ? `(${w.last_http_status})` : "(not sent)"}
                    <form method="post" action="/mock-gateway/console/action" style={{ display: "inline" }}>
                      <input type="hidden" name="action" value="resend" />
                      <input type="hidden" name="event_id" value={w.id} />
                      <Button variant="secondary" type="submit">
                        Send
                      </Button>
                    </form>
                  </div>
                ))}
              </td>
              <td>
                {p.status === "AUTHORIZED" || p.status === "PENDING" ? (
                  <form method="post" action="/mock-gateway/console/action" style={{ display: "inline" }}>
                    <input type="hidden" name="action" value="capture" />
                    <input type="hidden" name="payment_id" value={p.id} />
                    <Button type="submit" data-testid={`mock-capture-${p.id}`}>
                      Capture now (late)
                    </Button>
                  </form>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
