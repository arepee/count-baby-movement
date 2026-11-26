"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Log" },
  { href: "/history", label: "History" },
  { href: "/settings", label: "Settings" },
];

export default function BottomNav() {
  const pathname = usePathname();
  if (pathname === "/login") return null;
  return (
    <nav className="bottom-nav" aria-label="Main">
      {items.map((it) => {
        const active = it.href === "/" ? pathname === "/" : pathname.startsWith(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            className={active ? "nav-item active" : "nav-item"}
            aria-current={active ? "page" : undefined}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
