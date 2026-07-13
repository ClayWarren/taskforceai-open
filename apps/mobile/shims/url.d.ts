export declare const fileURLToPath: (url: string) => string;

declare const urlShim: {
  fileURLToPath: typeof fileURLToPath;
};

export default urlShim;
