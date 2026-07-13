import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from 'react';

interface AutoResizingTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  value: string;
  onValueChange: (value: string) => void;
  onEnterPress?: (e: React.KeyboardEvent) => void;
  minHeight?: number;
  maxHeight?: number;
}

export const AutoResizingTextarea = forwardRef<HTMLTextAreaElement, AutoResizingTextareaProps>(
  (
    {
      value,
      onValueChange,
      onEnterPress,
      minHeight = 48,
      maxHeight = 200,
      className,
      style,
      onChange,
      onKeyDown,
      ...props
    },
    ref
  ) => {
    const internalRef = useRef<HTMLTextAreaElement | null>(null);

    useImperativeHandle(ref, () => internalRef.current as HTMLTextAreaElement);

    const resizeTextarea = useCallback(() => {
      const textarea = internalRef.current;
      if (!textarea) {
        return;
      }

      textarea.style.height = '0px';
      const contentHeight = textarea.scrollHeight;
      const nextHeight = Math.min(Math.max(contentHeight, minHeight), maxHeight);
      textarea.style.height = `${nextHeight}px`;
      textarea.style.overflowY = contentHeight > maxHeight ? 'auto' : 'hidden';
    }, [maxHeight, minHeight]);

    useLayoutEffect(() => {
      resizeTextarea();
    }, [resizeTextarea, value]);

    useEffect(() => {
      if (typeof window === 'undefined') {
        return;
      }

      const handleResize = () => {
        resizeTextarea();
      };

      window.addEventListener('resize', handleResize);
      return () => {
        window.removeEventListener('resize', handleResize);
      };
    }, [resizeTextarea]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      onKeyDown?.(e);
      if (e.defaultPrevented) {
        return;
      }

      if (e.key === 'Enter' && !e.shiftKey && onEnterPress) {
        e.preventDefault();
        onEnterPress(e);
      }
    };

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onValueChange(e.target.value);
      onChange?.(e);
    };

    return (
      <textarea
        ref={internalRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        rows={1}
        className={className}
        style={{
          textAlign: 'left',
          ...style,
        }}
        {...props}
      />
    );
  }
);

AutoResizingTextarea.displayName = 'AutoResizingTextarea';
