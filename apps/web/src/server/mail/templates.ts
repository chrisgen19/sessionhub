import type { MailMessage } from "./types";

const HTML_ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (char) => HTML_ENTITIES[char] ?? char);

interface Content {
  subject: string;
  greeting: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  footer: string;
}

/** Plain-text and simple HTML versions of the same content. User-supplied text is escaped. */
const render = (to: string, { subject, greeting, paragraphs, action, footer }: Content): MailMessage => {
  const text = [greeting, ...paragraphs, ...(action ? [`${action.label}: ${action.url}`] : []), footer].join("\n\n");
  const button = action
    ? `<p><a href="${escapeHtml(action.url)}" style="display:inline-block;padding:10px 16px;background:#13694c;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(action.label)}</a></p><p style="font-size:12px;color:#555">Or paste this link into your browser:<br>${escapeHtml(action.url)}</p>`
    : "";
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;color:#111">${[greeting, ...paragraphs]
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("")}${button}<p style="font-size:12px;color:#555">${escapeHtml(footer)}</p></div>`;
  return { to, subject, text, html };
};

const IGNORE = "If you didn't ask for this, you can ignore this email.";

export const verificationEmail = (to: string, name: string, url: string): MailMessage =>
  render(to, {
    subject: "Confirm your email for SessionHub",
    greeting: `Hi ${name},`,
    paragraphs: ["Confirm that this is your email address. The link works for 24 hours."],
    action: { label: "Confirm email", url },
    footer: IGNORE,
  });

export const passwordResetEmail = (to: string, name: string, url: string): MailMessage =>
  render(to, {
    subject: "Reset your SessionHub password",
    greeting: `Hi ${name},`,
    paragraphs: ["Someone asked to reset the password for your SessionHub account. The link works for 1 hour and only once."],
    action: { label: "Choose a new password", url },
    footer: `${IGNORE} Your password stays the same.`,
  });

export const passwordChangedEmail = (to: string, name: string): MailMessage =>
  render(to, {
    subject: "Your SessionHub password was changed",
    greeting: `Hi ${name},`,
    paragraphs: [
      "The password for your SessionHub account was just reset, and every browser that was signed in has been signed out.",
      "If this wasn't you, reset your password again right away from the sign-in page.",
    ],
    footer: "This is a security notice; you can't turn it off.",
  });
