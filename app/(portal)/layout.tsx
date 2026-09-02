import Link from 'next/link';
import { requireStudentOrStaff, isStaff } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { NavLinks, type NavItem } from '@/components/nav';

/**
 * The signed-in shell. Everything under it has a session and a profile, and the
 * "you must change your password" gate has already been passed.
 *
 * The gate lives here rather than in middleware on purpose: middleware runs on
 * every request including static assets, and checking it there would mean a
 * database round trip per request just to read one boolean.
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const { profile, school } = await requireStudentOrStaff();
  const staff = isStaff(profile);

  let items: NavItem[];
  if (staff) {
    // The review queue count is the one number a teacher wants without clicking.
    const supabase = await createClient();
    const { count } = await supabase
      .from('attempts')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'submitted');

    items = [
      { href: '/teacher', label: 'Overview' },
      { href: '/teacher/classes', label: 'Classes' },
      { href: '/teacher/activities', label: 'Activities' },
      { href: '/teacher/assign', label: 'Assign' },
      { href: '/teacher/review', label: 'Review', count: count ?? 0 },
      { href: '/dashboard', label: 'My work' },
    ];
  } else {
    items = [{ href: '/dashboard', label: 'My work' }];
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface no-print">
        <div className="mx-auto w-full max-w-screen-2xl px-4 sm:px-6 lg:px-8 flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
          <Link
            href={staff ? '/teacher' : '/dashboard'}
            className="text-[17px] font-bold tracking-tight"
          >
            Nybble
            {school && <span className="ml-2 font-normal text-muted">{school.name}</span>}
          </Link>

          <NavLinks items={items} />

          <div className="flex items-center gap-3">
            <Link
              href="/change-password"
              className="text-[15px] text-muted hover:text-accent"
              title="Change your password"
            >
              {profile.display_name}
            </Link>
            {/* POST, so no drive-by sign-out from an <img> tag elsewhere. */}
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="rounded-lg border border-line px-3 py-1.5 text-[14px] font-semibold text-muted hover:border-accent hover:text-accent"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      {children}
    </div>
  );
}
