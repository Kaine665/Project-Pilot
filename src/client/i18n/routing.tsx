/**
 * Navigation compatibility layer.
 * Drop-in replacement for the old `@/i18n/routing` that was backed by next-intl.
 * Keeps the same export signatures so existing components don't need changes.
 */
import {
  Link as RouterLink,
  useNavigate,
  useLocation,
  useParams,
  useSearchParams,
  Navigate,
} from 'react-router';
import { forwardRef, type AnchorHTMLAttributes } from 'react';

export type Locale = 'zh' | 'en';

interface CompatLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to?: string;
  href?: string;
  replace?: boolean;
  className?: string;
}

/**
 * Drop-in Link that accepts both `to` (React Router) and `href` (Next.js style).
 */
export const Link = forwardRef<HTMLAnchorElement, CompatLinkProps>(
  function CompatLink({ href, to, ...rest }, ref) {
    return <RouterLink ref={ref} to={to ?? href ?? '#'} {...rest} />;
  },
);

export function usePathname(): string {
  const { pathname } = useLocation();
  return pathname.replace(/^\/(zh|en)/, '') || '/';
}

export function useRouter() {
  const navigate = useNavigate();
  return {
    push: (path: string) => navigate(path),
    replace: (path: string) => navigate(path, { replace: true }),
    back: () => navigate(-1),
  };
}

export function redirect(path: string): never {
  throw new Error(
    `redirect() cannot be called in client code. Use <Navigate to="${path}" /> instead.`,
  );
}

export { Navigate, useParams, useSearchParams };
