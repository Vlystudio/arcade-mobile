export type ValidationResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

type TextRules = {
  field: string;
  min?: number;
  max: number;
  allowEmpty?: boolean;
};

const COMMON_WEAK_PASSWORDS = new Set([
  "password",
  "password1",
  "password12",
  "password123",
  "password1234",
  "123456",
  "123456789",
  "1234567890",
  "qwerty",
  "qwerty123",
  "letmein",
  "welcome",
  "welcome1",
  "iloveyou",
  "admin",
  "arcade",
  "arcadetracker",
  "vlystudio",
  "vlystudios",
]);

export const VALIDATION_LIMITS = {
  post: 1000,
  comment: 500,
  forumTitle: 80,
  forumDescription: 500,
  teamName: 40,
  tournamentTitle: 80,
  tournamentDescription: 1000,
  chatMessage: 2000,
  supportFeedback: 2000,
  foodInstructions: 300,
  tableNumber: 40,
  scoreMax: 100000000000,
};

export function normalizeUserText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function validateText(value: unknown, rules: TextRules): ValidationResult {
  const normalized = normalizeUserText(value);
  if (!normalized) {
    return rules.allowEmpty
      ? { ok: true, value: "" }
      : { ok: false, error: `${rules.field} is required.` };
  }
  if (rules.min && normalized.length < rules.min) {
    return { ok: false, error: `${rules.field} must be at least ${rules.min} characters.` };
  }
  if (normalized.length > rules.max) {
    return { ok: false, error: `${rules.field} must be ${rules.max} characters or less.` };
  }
  return { ok: true, value: normalized };
}

export const validatePostContent = (value: unknown) =>
  validateText(value, { field: "Post", max: VALIDATION_LIMITS.post, allowEmpty: true });

export const validateCommentContent = (value: unknown) =>
  validateText(value, { field: "Comment", min: 1, max: VALIDATION_LIMITS.comment });

export const validateForumTitle = (value: unknown) =>
  validateText(value, { field: "Forum title", min: 3, max: VALIDATION_LIMITS.forumTitle });

export const validateForumDescription = (value: unknown) =>
  validateText(value, { field: "Forum description", max: VALIDATION_LIMITS.forumDescription, allowEmpty: true });

export const validateTeamName = (value: unknown) =>
  validateText(value, { field: "Team name", min: 2, max: VALIDATION_LIMITS.teamName });

export const validateTournamentTitle = (value: unknown) =>
  validateText(value, { field: "Tournament title", min: 3, max: VALIDATION_LIMITS.tournamentTitle });

export const validateTournamentDescription = (value: unknown) =>
  validateText(value, { field: "Tournament description", max: VALIDATION_LIMITS.tournamentDescription, allowEmpty: true });

export const validateChatMessage = (value: unknown) =>
  validateText(value, { field: "Message", min: 1, max: VALIDATION_LIMITS.chatMessage });

export const validateSupportFeedback = (value: unknown) =>
  validateText(value, { field: "Message", min: 10, max: VALIDATION_LIMITS.supportFeedback });

export const validateFoodInstructions = (value: unknown) =>
  validateText(value, { field: "Instructions", max: VALIDATION_LIMITS.foodInstructions, allowEmpty: true });

export function validateTableNumber(value: unknown): ValidationResult {
  const normalized = normalizeUserText(value);
  if (!normalized) return { ok: true, value: "" };
  if (normalized.length > VALIDATION_LIMITS.tableNumber) {
    return { ok: false, error: `Table or lane must be ${VALIDATION_LIMITS.tableNumber} characters or less.` };
  }
  if (!/^[a-z0-9 #._-]+$/i.test(normalized)) {
    return { ok: false, error: "Table or lane contains unsupported characters." };
  }
  return { ok: true, value: normalized };
}

export function validateScoreValue(value: unknown): { ok: true; value: number } | { ok: false; error: string } {
  const score = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isSafeInteger(score) || score < 0 || score > VALIDATION_LIMITS.scoreMax) {
    return { ok: false, error: "Enter a valid score." };
  }
  return { ok: true, value: score };
}

export function validatePasswordStrength(
  password: unknown,
  context: { email?: string | null; username?: string | null } = {}
): ValidationResult {
  const value = typeof password === "string" ? password : "";
  const lower = value.toLowerCase();
  const compact = lower.replace(/[^a-z0-9]/g, "");

  if (value.length < 12) {
    return { ok: false, error: "Password does not meet security requirements." };
  }
  if (COMMON_WEAK_PASSWORDS.has(lower) || COMMON_WEAK_PASSWORDS.has(compact)) {
    return { ok: false, error: "Password does not meet security requirements." };
  }
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/[0-9]/.test(value)) {
    return { ok: false, error: "Password does not meet security requirements." };
  }

  const fragments = [
    ...String(context.email ?? "").toLowerCase().split(/[@._+\-\s]+/),
    ...String(context.username ?? "").toLowerCase().split(/[@._+\-\s]+/),
    "password",
    "arcadetracker",
  ].filter((part) => part.length >= 4);

  if (fragments.some((part) => lower.includes(part))) {
    return { ok: false, error: "Password does not meet security requirements." };
  }

  return { ok: true, value };
}
