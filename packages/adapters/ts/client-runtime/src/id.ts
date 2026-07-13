export type ClientIdFactory = (prefix: string) => string;

let idFactory: ClientIdFactory | undefined;

export const configureClientIdFactory = (factory: ClientIdFactory): void => {
  idFactory = factory;
};

export const createId = (prefix: string): string => {
  if (!idFactory) {
    throw new Error('Client ID factory has not been configured by the application');
  }
  return idFactory(prefix);
};
