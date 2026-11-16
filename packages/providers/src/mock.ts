// Deterministic mock providers for local development and tests. They never move money, send email or call a map API.
import { SYNTHETIC_VENUES } from "@simply-sit/synthetic-data";
import type { AreaSuggestion, EmailMessage, EmailProvider, EmailResult, MapsProvider } from "./types";

export class MockEmailProvider implements EmailProvider {
  readonly mode = "mock" as const;
  private readonly byKey = new Map<string, EmailResult>();
  readonly outbox: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<EmailResult> {
    // Repeated delivery of the same logical message records it once (docs/01-PRD.md AC-11).
    const previous = this.byKey.get(message.idempotencyKey);
    if (previous) return previous;
    const result: EmailResult = { messageId: `mock_email_${this.byKey.size + 1}`, delivered: false, mode: "mock" };
    this.byKey.set(message.idempotencyKey, result);
    this.outbox.push(message);
    return result;
  }
}

export class MockMapsProvider implements MapsProvider {
  readonly mode = "mock" as const;

  async searchAreas(query: string): Promise<AreaSuggestion[]> {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return [];
    const localities = [...new Set(SYNTHETIC_VENUES.map((venue) => venue.locality))];
    return localities.filter((label) => label.toLowerCase().includes(needle)).map((label) => ({ label, isSynthetic: true as const }));
  }
}
