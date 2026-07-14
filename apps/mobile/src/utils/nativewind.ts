import { styled as nativewindStyled } from 'nativewind';
import type {
  ComponentType,
  ForwardRefExoticComponent,
  PropsWithoutRef,
  RefAttributes,
} from 'react';

type AnyComponent<Props = unknown> =
  | ComponentType<Props>
  | ForwardRefExoticComponent<PropsWithoutRef<Props> & RefAttributes<unknown>>;

/**
 * Compatibility wrapper that preserves the legacy single-argument callsite.
 */
export function styled<TProps>(Component: AnyComponent<TProps>): AnyComponent<TProps> {
  // Type assertion justified: NativeWind's styled() has overly strict generic constraints;
  // casting to never bypasses constraints, then casting result back to preserve component type
  return nativewindStyled(Component as never) as AnyComponent<TProps>;
}
