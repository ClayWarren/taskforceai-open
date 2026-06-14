declare module '@react-email/render' {
  import type { ReactElement } from 'react';

  export type RenderOptions = {
    plainText?: boolean;
  };

  export function render(element: ReactElement, options?: RenderOptions): Promise<string>;
}
