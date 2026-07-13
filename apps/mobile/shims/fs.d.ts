export declare const existsSync: (path: string) => boolean;
export declare const mkdirSync: (path: string, options?: unknown) => void;
export declare const writeFileSync: (path: string, data: string, options?: unknown) => void;
export declare const readFileSync: (path: string, encoding?: string) => string;

declare const fsShim: {
  existsSync: typeof existsSync;
  mkdirSync: typeof mkdirSync;
  writeFileSync: typeof writeFileSync;
  readFileSync: typeof readFileSync;
};

export default fsShim;
