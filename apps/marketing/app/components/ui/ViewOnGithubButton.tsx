import { Link } from '@tanstack/react-router';

import { Button } from './button';
import { GithubIcon } from './icons';

interface ViewOnGithubButtonProps {
  href: string;
}

export function ViewOnGithubButton({ href }: ViewOnGithubButtonProps) {
  return (
    <Button variant="outline" asChild>
      <Link to={href} target="_blank" rel="noopener noreferrer">
        <GithubIcon className="mr-2 h-4 w-4" />
        View on GitHub
      </Link>
    </Button>
  );
}
