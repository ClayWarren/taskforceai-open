import { Link as TanStackLink } from '@tanstack/react-router';
import type { ComponentProps } from 'react';

export type LinkProps = ComponentProps<typeof TanStackLink>;

export const Link = TanStackLink;
