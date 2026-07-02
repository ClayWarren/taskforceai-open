declare module 'resend' {
  export type ResendSendEmailParams = {
    from: string;
    to: string | string[];
    subject: string;
    html: string;
    text?: string;
    replyTo?: string;
  };

  export type ResendSendEmailResponse = {
    data?: { id?: string } | null;
    error?: unknown;
  };

  export class Resend {
    constructor(apiKey: string);
    emails: {
      send(params: ResendSendEmailParams): Promise<ResendSendEmailResponse>;
    };
  }
}
