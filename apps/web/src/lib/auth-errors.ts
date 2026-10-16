const MESSAGES: Record<string, string> = {
  USER_ALREADY_EXISTS: "An account with this email already exists. Sign in instead.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "An account with this email already exists. Sign in instead.",
  INVALID_EMAIL_OR_PASSWORD: "Email or password is incorrect.",
  PASSWORD_TOO_SHORT: "That password is too short.",
  PASSWORD_TOO_LONG: "That password is too long.",
  INVALID_EMAIL: "Enter a valid email address.",
  INVALID_NAME: "Enter a name of 120 characters or fewer.",
};

export interface AuthErrorLike {
  status?: number | undefined;
  code?: string | undefined;
}

/** User-facing message for a failed Better Auth request. Never echoes server text. */
export const authErrorMessage = (error: AuthErrorLike | null | undefined): string => {
  if (!error) return "We couldn't reach the account service. Try again in a moment.";
  if (error.status === 429) return "Too many attempts. Wait a minute and try again.";
  return (error.code && MESSAGES[error.code]) || "That didn't work. Check your details and try again.";
};
