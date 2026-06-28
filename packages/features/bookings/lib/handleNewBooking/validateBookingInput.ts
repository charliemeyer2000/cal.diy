import dayjs from "@calcom/dayjs";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";

interface BookingInputFields {
  eventTypeId: unknown;
  start: unknown;
  end?: unknown;
  language: unknown;
  timeZone: unknown;
  metadata: unknown;
  rescheduleUid?: unknown;
  rescheduledBy?: unknown;
}

interface ValidationFailure {
  field: string;
  message: string;
}

interface ValidationSuccess {
  valid: true;
}

interface ValidationError {
  valid: false;
  errors: [ValidationFailure, ...ValidationFailure[]];
}

type ValidationResult = ValidationSuccess | ValidationError;

const ISO_8601_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isValidISODatetime(value: string): boolean {
  if (!ISO_8601_REGEX.test(value)) {
    return false;
  }
  const parsed = dayjs(value);
  return parsed.isValid();
}

function validateBookingInput(input: BookingInputFields): ValidationResult {
  const errors: ValidationFailure[] = [];

  if (!isPositiveInteger(input.eventTypeId)) {
    errors.push({
      field: "eventTypeId",
      message: "eventTypeId must be a positive integer identifying the event type to book.",
    });
  }

  if (!isNonEmptyString(input.start)) {
    errors.push({
      field: "start",
      message:
        "start is required and must be a non-empty ISO 8601 datetime string (e.g. 2024-01-15T10:00:00Z).",
    });
  } else if (!isValidISODatetime(input.start)) {
    errors.push({
      field: "start",
      message: `start must be a valid ISO 8601 datetime (e.g. 2024-01-15T10:00:00Z). Received: "${input.start}".`,
    });
  }

  if (input.end !== undefined && input.end !== null) {
    if (!isNonEmptyString(input.end)) {
      errors.push({
        field: "end",
        message: "end must be a valid ISO 8601 datetime string when provided (e.g. 2024-01-15T10:30:00Z).",
      });
    } else if (!isValidISODatetime(input.end)) {
      errors.push({
        field: "end",
        message: `end must be a valid ISO 8601 datetime (e.g. 2024-01-15T10:30:00Z). Received: "${input.end}".`,
      });
    } else if (
      isNonEmptyString(input.start) &&
      isValidISODatetime(input.start) &&
      dayjs(input.end).isBefore(dayjs(input.start))
    ) {
      errors.push({
        field: "end",
        message: "end must be after start. The booking cannot end before it begins.",
      });
    }
  }

  if (!isNonEmptyString(input.language)) {
    errors.push({
      field: "language",
      message: 'language is required and must be a non-empty locale string (e.g. "en").',
    });
  }

  if (!isNonEmptyString(input.timeZone)) {
    errors.push({
      field: "timeZone",
      message: 'timeZone is required and must be a valid IANA timezone string (e.g. "America/New_York").',
    });
  }

  if (
    input.metadata === null ||
    input.metadata === undefined ||
    typeof input.metadata !== "object" ||
    Array.isArray(input.metadata)
  ) {
    errors.push({
      field: "metadata",
      message: "metadata is required and must be a JSON object (e.g. {}).",
    });
  }

  if (input.rescheduleUid !== undefined && input.rescheduleUid !== null) {
    if (!isNonEmptyString(input.rescheduleUid)) {
      errors.push({
        field: "rescheduleUid",
        message: "rescheduleUid must be a non-empty string when provided.",
      });
    }
  }

  if (input.rescheduledBy !== undefined && input.rescheduledBy !== null) {
    if (typeof input.rescheduledBy !== "string" || !EMAIL_REGEX.test(input.rescheduledBy)) {
      errors.push({
        field: "rescheduledBy",
        message: "rescheduledBy must be a valid email address when provided.",
      });
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors: errors as [ValidationFailure, ...ValidationFailure[]] };
  }

  return { valid: true };
}

function assertValidBookingInput(input: BookingInputFields): void {
  const result = validateBookingInput(input);
  if (!result.valid) {
    const summary = result.errors.map((e) => `${e.field}: ${e.message}`).join("; ");
    throw new ErrorWithCode(ErrorCode.RequestBodyInvalid, `Invalid booking input — ${summary}`, {
      validationErrors: result.errors,
    });
  }
}

export type { BookingInputFields, ValidationFailure, ValidationSuccess, ValidationError, ValidationResult };
export { validateBookingInput, assertValidBookingInput };
