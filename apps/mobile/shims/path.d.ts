export declare const dirname: (path: string) => string;
export declare const resolve: (...parts: string[]) => string;
export declare const join: (...parts: string[]) => string;

declare const pathShim: {
  dirname: typeof dirname;
  resolve: typeof resolve;
  join: typeof join;
};

export default pathShim;
