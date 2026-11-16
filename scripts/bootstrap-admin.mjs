// Owner-controlled bootstrap of the first platform superadmin (docs/02 s.5: "Bootstrap one admin using an explicit
// owner-controlled process; no default privileged seed account"). Not exposed through any API.
// Usage: node scripts/bootstrap-admin.mjs <email-of-existing-account> "<reason>"
// Refuses a non-local DATABASE_URL unless BOOTSTRAP_CONFIRM_REMOTE=yes is set by the owner for that one run.
import postgres from "postgres";

const [email, reason] = process.argv.slice(2);
if (!email || !reason || reason.length < 3) {
  console.error('Usage: node scripts/bootstrap-admin.mjs <email> "<reason>"');
  process.exit(2);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required (owner-held credential; never commit it).");
  process.exit(2);
}
const host = new URL(url).hostname;
if (!["127.0.0.1", "localhost"].includes(host) && process.env.BOOTSTRAP_CONFIRM_REMOTE !== "yes") {
  console.error(`Refusing to modify non-local database host ${host} without BOOTSTRAP_CONFIRM_REMOTE=yes.`);
  process.exit(2);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  await sql.begin(async (tx) => {
    const [profile] = await tx`
      select p.id from public.profiles p join auth.users u on u.id = p.auth_user_id
      where lower(u.email) = lower(${email}) and p.status = 'ACTIVE'`;
    if (!profile) throw new Error("No ACTIVE account with that email. The person must sign in once first.");
    const [existing] = await tx`select 1 from public.platform_memberships where user_id = ${profile.id} and role = 'SUPERADMIN' and status = 'ACTIVE'`;
    if (existing) {
      console.info("Already an active superadmin; nothing changed.");
      return;
    }
    const [membership] = await tx`
      insert into public.platform_memberships (user_id, role, status, reason)
      values (${profile.id}, 'SUPERADMIN', 'ACTIVE', ${reason})
      on conflict (user_id, role) do update set status = 'ACTIVE', reason = excluded.reason
      returning id`;
    await tx`
      insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, reason, safe_diff)
      values (null, 'OWNER_BOOTSTRAP', 'platform_role.grant', 'platform_membership', ${membership.id}, ${reason},
              ${tx.json({ role: "SUPERADMIN" })})`;
    console.info("Granted SUPERADMIN. The account must enrol an authenticator before admin actions (aal2).");
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : "bootstrap failed");
  process.exitCode = 1;
} finally {
  await sql.end();
}
