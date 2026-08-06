"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS: Array<[string, string, string]> = [
  ["/", "Today", "What needs judgment"],
  ["/scorecard", "Scorecard", "What actually works"],
  ["/signals", "Signals", "Everything collected"],
  ["/positions", "Positions", "Why you own each one"],
  ["/decisions", "Decisions", "What you did and why"],
  ["/events", "Events", "Expectation vs reality"],
  ["/beliefs", "Beliefs", "What the book really bets on"],
  ["/replay", "Replay", "Decide again, without hindsight"],
  ["/patterns", "Patterns", "What you keep doing"],
];

/** Horizontal strip for narrow screens, where the sidebar is hidden. */
export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav className="-mx-6 mb-8 flex gap-1 overflow-x-auto border-b border-rule px-6 pb-3 lg:hidden">
      {ITEMS.map(([href, label]) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`shrink-0 border px-2.5 py-1 text-[12px] ${
              active ? "border-ink bg-ink text-paper" : "border-rule-2 text-ink-2"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="space-y-[2px]">
      {ITEMS.map(([href, label, hint]) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`block border-l-2 py-[7px] pl-3 transition-colors ${
              active
                ? "border-ink bg-wash"
                : "border-transparent hover:border-rule-2 hover:bg-wash/60"
            }`}
          >
            <span className={`block text-[13px] ${active ? "font-medium text-ink" : "text-ink-2"}`}>
              {label}
            </span>
            <span className="mt-[1px] block text-[10.5px] leading-tight text-ink-4">{hint}</span>
          </Link>
        );
      })}
    </nav>
  );
}
