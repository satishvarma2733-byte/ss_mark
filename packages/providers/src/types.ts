// Provider adapter contracts. SERVER-ONLY: never import this package from apps/mobile or a "use client" module.
// Only mock implementations exist. Real adapters (Razorpay, Resend, Google Maps) need owner accounts and arrive behind
// these interfaces. The payment gateway contract is in gateway.ts (it needs a database-backed mock).
export type ProviderMode = "mock";

export type EmailMessage = {
  to: string;
  template: string;
  idempotencyKey: string;
  // Template values such as an accept link (relative to the app URL). May hold a secret token: never log them.
  values?: Record<string, string>;
};

export type EmailResult = {
  messageId: string;
  delivered: false;
  mode: ProviderMode;
};

export interface EmailProvider {
  readonly mode: ProviderMode;
  send(message: EmailMessage): Promise<EmailResult>;
}

export type AreaSuggestion = { label: string; isSynthetic: true };

export interface MapsProvider {
  readonly mode: ProviderMode;
  searchAreas(query: string): Promise<AreaSuggestion[]>;
}

export type Providers = {
  email: EmailProvider;
  maps: MapsProvider;
};
