export interface MailAddress {
  email: string;
  name?: string | undefined;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Delivers one message or throws. Implementations must not include secrets in errors. */
export interface MailTransport {
  readonly name: string;
  send: (message: MailMessage) => Promise<void>;
}

/** `Name <email>` or a bare `email` (the MAIL_FROM format). */
export const parseAddress = (value: string): MailAddress => {
  const match = /^\s*(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(value);
  const [, name, email] = match ?? [];
  if (email) return { email, name: name ? name.replace(/^"|"$/g, "") : undefined };
  return { email: value.trim() };
};

export const formatAddress = ({ email, name }: MailAddress): string => (name ? `${name} <${email}>` : email);
