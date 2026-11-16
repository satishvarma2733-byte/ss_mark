// Finance sub-sections (Figma "D · Admin desktop" finance frames): overview, refunds queue and fee versions.
const TABS = [
  { href: "/admin/finance", label: "Overview" },
  { href: "/admin/finance/refunds", label: "Refunds" },
  { href: "/admin/finance/fees", label: "Fee versions" }
];

export function FinanceTabs({ active }: { active: string }) {
  return (
    <nav aria-label="Finance sections" className="page-lede">
      <ul className="choice-pills">
        {TABS.map((t) => (
          <li key={t.href}>
            <a className={`choice-pill${t.href === active ? " selected" : ""}`} href={t.href} aria-current={t.href === active ? "page" : undefined}>
              {t.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
