import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { MobileNav, Nav } from "@/components/nav";

/*
 * Every page reads a live local database and renders relative to "now". Static
 * prerendering would freeze both at build time — the sidebar would show the build
 * date and every "3 months ago" would stop moving.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "AsOf — a self-grading market intelligence engine",
  description:
    "Collects signals, seals each at the moment it was knowable, and grades what actually happened next against the index — including your own decisions.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <html lang="en">
      <body>
        <div className="mx-auto flex min-h-screen max-w-[1320px]">
          <aside className="sticky top-0 hidden h-screen w-[218px] shrink-0 flex-col border-r border-rule px-5 py-7 lg:flex">
            <Link href="/" className="mb-8 block">
              <span className="display block text-[23px] leading-none">AsOf</span>
              <span className="mt-2 block text-[10.5px] leading-tight text-ink-3">
                What you knew,
                <br />
                when you knew it.
              </span>
            </Link>

            <Nav />

            <div className="mt-auto border-t border-rule pt-4">
              <div className="label mb-1">Viewing as of</div>
              <div className="text-[11.5px] leading-tight text-ink-2">{today}</div>
              <p className="mt-3 text-[10.5px] leading-snug text-ink-4">
                Local only. Demo journal; real prices and filings via the daily refresh.
              </p>
            </div>
          </aside>

          <main className="min-w-0 flex-1 px-6 py-8 sm:px-10 sm:py-12">
            <div className="mb-4 flex items-baseline justify-between lg:hidden">
              <Link href="/" className="display text-[20px]">
                AsOf
              </Link>
              <span className="label">{today}</span>
            </div>
            <MobileNav />
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
