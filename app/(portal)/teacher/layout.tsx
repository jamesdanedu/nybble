import { requireStaffSession } from '@/lib/session';

/**
 * Staff gate. `requireStaffSession` redirects a student to their dashboard,
 * so a mistyped URL is a bounce rather than a 403 page. The real boundary is
 * still RLS — `is_staff()` guards every teacher-only policy in the schema, and
 * this layout is only there to keep the UI honest.
 */
export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  await requireStaffSession();
  return <>{children}</>;
}
