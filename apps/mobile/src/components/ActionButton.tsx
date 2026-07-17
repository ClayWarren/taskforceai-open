/**
 * Shared Action Button - Implements LSP by extending TouchableOpacityProps
 */
import React from 'react';
import {
  ActivityIndicator,
  Text,
  TouchableOpacity,
  type TouchableOpacityProps,
} from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { cn } from '@taskforceai/ui-kit/utils';

type ButtonVariant = 'default' | 'primary' | 'primaryOutline' | 'danger';
type ButtonSize = 'default' | 'large';

interface ActionButtonProps extends TouchableOpacityProps {
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
}

export const ActionButton = React.memo(function ActionButtonComponent({
  children,
  variant = 'default',
  size = 'default',
  isLoading,
  disabled,
  style,
  className,
  ...props
}: ActionButtonProps) {
  const { theme } = useTheme();

  const baseClass = 'mb-3 rounded-2xl border px-lg';

  const variants: Record<ButtonVariant, { container: string; color: string }> = {
    default: { container: 'border-white/10 bg-white/5', color: theme.colors.text },
    primary: { container: 'border-primary bg-primary', color: theme.colors.white },
    primaryOutline: { container: 'border-primary/60 bg-primary/10', color: theme.colors.primary },
    danger: { container: 'border-error/60 bg-error/10', color: theme.colors.error },
  };
  const sizes: Record<ButtonSize, { container: string; label: string }> = {
    default: { container: 'py-md', label: 'text-base' },
    large: { container: 'py-lg', label: 'text-lg' },
  };

  const variantStyles = variants[variant];
  const sizeStyles = sizes[size];

  return (
    <TouchableOpacity
      {...props}
      disabled={disabled || isLoading}
      className={cn(
        baseClass,
        variantStyles.container,
        sizeStyles.container,
        (disabled || isLoading) && 'opacity-60',
        className
      )}
      style={style}
    >
      {isLoading ? (
        <ActivityIndicator color={variantStyles.color} />
      ) : (
        <Text className={cn('text-center font-semibold', sizeStyles.label)} style={{ color: variantStyles.color }}>
          {children}
        </Text>
      )}
    </TouchableOpacity>
  );
});
