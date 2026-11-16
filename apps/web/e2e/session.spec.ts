// Web session recovery (docs/05 "Auth lifecycle", docs/08 T23): expired access tokens refresh transparently through
// proxy.ts using the refresh token; a session revoked at the Auth server falls back to sign-in and 401 on the API.
import { expect, test } from "@playwright/test";
import { createFixtureUser, db, readSessionCookie, signInWithEmailCode, writeSessionCookie } from "./helpers";

const BASE = "http://localhost:3100";

test("an expired access token is refreshed by the proxy without asking the user to sign in again", async ({ page, context }) => {
  const user = await createFixtureUser();
  await page.goto("/sign-in?redirect_path=/account");
  await signInWithEmailCode(page, user.email);
  await expect(page.getByTestId("account-email")).toHaveText(user.email);

  const before = await readSessionCookie(context);
  // Mark the stored session as expired one minute ago; the access token itself is untouched.
  await writeSessionCookie(context, BASE, before.name, { ...before.session, expires_at: Math.floor(Date.now() / 1000) - 60 }, before.encoded);

  await page.goto("/account");
  await expect(page.getByTestId("account-email")).toHaveText(user.email);
  const after = await readSessionCookie(context);
  expect(after.session.access_token).not.toBe(before.session.access_token);
  expect(after.session.refresh_token).not.toBe(before.session.refresh_token); // rotation is enabled
  expect(after.session.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000) + 300);
  const cookies = (await context.cookies()).filter((c) => c.name.startsWith(before.name));
  expect(cookies.every((c) => c.httpOnly)).toBe(true);

  // The API accepts the refreshed cookie session.
  expect((await page.request.get("/api/v1/me")).status()).toBe(200);
});

test("a session revoked at the Auth server sends the user back to sign-in and the API answers 401", async ({ page }) => {
  const user = await createFixtureUser();
  await page.goto("/sign-in?redirect_path=/account");
  await signInWithEmailCode(page, user.email);
  await expect(page.getByTestId("account-email")).toHaveText(user.email);

  // Equivalent of "sign out everywhere" / an admin revocation.
  await db()`delete from auth.sessions where user_id = ${user.id}::uuid`;

  const me = await page.request.get("/api/v1/me");
  expect(me.status()).toBe(401);
  await page.goto("/account");
  await expect(page).toHaveURL(/\/sign-in\?redirect_path=(%2F|\/)account$/);
});

test("a tampered session cookie is rejected rather than trusted", async ({ page, context }) => {
  const user = await createFixtureUser();
  await page.goto("/sign-in?redirect_path=/account");
  await signInWithEmailCode(page, user.email);
  await expect(page.getByTestId("account-email")).toHaveText(user.email);

  const current = await readSessionCookie(context);
  const [header, payload] = current.session.access_token.split(".");
  const claims = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8")) as Record<string, unknown>;
  // Forge an aal2 claim without a valid signature.
  const forged = `${header}.${Buffer.from(JSON.stringify({ ...claims, aal: "aal2" })).toString("base64url")}.invalid-signature`;
  await writeSessionCookie(context, BASE, current.name, { ...current.session, access_token: forged }, current.encoded);

  const me = await page.request.get("/api/v1/me");
  // Either the forged token is refused outright, or the refresh token restores a genuine aal1 session; never aal2.
  if (me.status() === 200) expect((await me.json()).data.aal).toBe("aal1");
  else expect(me.status()).toBe(401);
});
