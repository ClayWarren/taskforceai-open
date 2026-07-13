import { Link } from '@tanstack/react-router';
import type { AnchorHTMLAttributes } from 'react';

import { splitInternalRouterHref } from '@/lib/router-links';

type RouterAwareLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string;
};

export function RouterAwareLink({ href, ...props }: RouterAwareLinkProps) {
  const routerHref = splitInternalRouterHref(href);
  return routerHref ? (
    <Link to={routerHref.to} hash={routerHref.hash} {...props} />
  ) : (
    <a href={href} {...props} />
  );
}
