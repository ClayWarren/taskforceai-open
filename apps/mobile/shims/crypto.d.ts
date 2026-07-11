export declare const randomUUID: () => string;

declare const cryptoShim: {
  randomUUID: typeof randomUUID;
};

export default cryptoShim;
