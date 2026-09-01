'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx } from './ui';

export interface NavItem {
  href: string;
  label: string;
  /** Badge count, e.g. how many attempts are waiting in the review queue. */
  count?: number;
}

export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-1 flex-wrap items-center gap-1 overflow-x-auto">
      {items.map((item) => {
        const active =
          pathname === item.href ||
          (item.href !== '/' && pathname.startsWith(item.href + '/'));
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cx(
              'inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-[15px] font-semibold transition',
              active ? 'bg-accent-soft text-accent' : 'text-muted hover:text-ink',
            )}
          >
            {item.label}
            {typeof item.count === 'number' && item.count > 0 && (
              <span className="inline-flex min-w-[20px] justify-center rounded-full border border-accent bg-accent-soft px-1.5 text-[12.5px] tabular-nums text-accent">
                {item.count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
