import Link from "next/link";
import { PageHeader } from "@/components/ui";

/**
 * Without this, Next's default 404 renders as a black panel dropped inside the
 * app's white layout.
 */
export default function NotFound() {
  return (
    <>
      <PageHeader
        eyebrow="Not found"
        title="There is no record at that address"
        lede="Either the link is wrong, or the position, decision or event it pointed at was never written down. Nothing here has been deleted — AsOf does not remove records."
      />
      <ul className="divide-y divide-rule border-y border-rule">
        {[
          ["/", "Today", "What needs judgment"],
          ["/positions", "Positions", "Why you own each one"],
          ["/decisions", "Decisions", "What you did and why"],
          ["/replay", "Replay", "Decide again, without hindsight"],
        ].map(([href, label, hint]) => (
          <li key={href}>
            <Link href={href} className="flex items-baseline gap-4 py-3.5 hover:bg-wash/70">
              <span className="w-[110px] shrink-0 text-[13.5px] font-medium">{label}</span>
              <span className="text-[12.5px] text-ink-3">{hint}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
