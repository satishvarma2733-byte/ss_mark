// Runs once before the Next.js server accepts requests. Invalid configuration stops startup instead of serving in a wrong mode.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getServerEnv, validatePaymentConfig } = await import("./lib/server-env");
    try {
      getServerEnv();
      validatePaymentConfig();
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  }
}
