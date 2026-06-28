import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { describe, expect, it } from "vitest";
import type { BookingInputFields, ValidationError } from "./validateBookingInput";
import { assertValidBookingInput, validateBookingInput } from "./validateBookingInput";

function validInput(overrides: Partial<BookingInputFields> = {}): BookingInputFields {
  return {
    eventTypeId: 1,
    start: "2024-01-15T10:00:00.000Z",
    language: "en",
    timeZone: "America/New_York",
    metadata: {},
    ...overrides,
  };
}

describe("validateBookingInput", () => {
  describe("valid inputs", () => {
    it("accepts minimal valid booking input", () => {
      const result = validateBookingInput(validInput());
      expect(result).toEqual({ valid: true });
    });

    it("accepts input with optional end", () => {
      const result = validateBookingInput(validInput({ end: "2024-01-15T10:30:00.000Z" }));
      expect(result).toEqual({ valid: true });
    });

    it("accepts input with rescheduleUid", () => {
      const result = validateBookingInput(validInput({ rescheduleUid: "abc-123-uid" }));
      expect(result).toEqual({ valid: true });
    });

    it("accepts input with rescheduledBy email", () => {
      const result = validateBookingInput(validInput({ rescheduledBy: "user@example.com" }));
      expect(result).toEqual({ valid: true });
    });

    it("accepts input with all optional fields", () => {
      const result = validateBookingInput(
        validInput({
          end: "2024-01-15T10:30:00.000Z",
          rescheduleUid: "uid-456",
          rescheduledBy: "admin@example.com",
        })
      );
      expect(result).toEqual({ valid: true });
    });

    it("accepts null/undefined optional fields", () => {
      const result = validateBookingInput(
        validInput({ end: undefined, rescheduleUid: undefined, rescheduledBy: undefined })
      );
      expect(result).toEqual({ valid: true });
    });

    it("treats null end the same as undefined", () => {
      const result = validateBookingInput(validInput({ end: null }));
      expect(result).toEqual({ valid: true });
    });
  });

  describe("eventTypeId validation", () => {
    it("rejects missing eventTypeId", () => {
      const result = validateBookingInput(validInput({ eventTypeId: undefined }));
      expect(result.valid).toBe(false);
      expect((result as ValidationError).errors[0].field).toBe("eventTypeId");
    });

    it("rejects zero eventTypeId", () => {
      const result = validateBookingInput(validInput({ eventTypeId: 0 }));
      expect(result.valid).toBe(false);
      expect((result as ValidationError).errors[0].field).toBe("eventTypeId");
    });

    it("rejects negative eventTypeId", () => {
      const result = validateBookingInput(validInput({ eventTypeId: -5 }));
      expect(result.valid).toBe(false);
      expect((result as ValidationError).errors[0].field).toBe("eventTypeId");
    });

    it("rejects non-integer eventTypeId", () => {
      const result = validateBookingInput(validInput({ eventTypeId: 1.5 }));
      expect(result.valid).toBe(false);
      expect((result as ValidationError).errors[0].field).toBe("eventTypeId");
    });

    it("rejects string eventTypeId", () => {
      const result = validateBookingInput(validInput({ eventTypeId: "1" }));
      expect(result.valid).toBe(false);
      expect((result as ValidationError).errors[0].field).toBe("eventTypeId");
      expect((result as ValidationError).errors[0].message).toContain("positive integer");
    });
  });

  describe("start validation", () => {
    it("rejects missing start", () => {
      const result = validateBookingInput(validInput({ start: undefined }));
      expect(result.valid).toBe(false);
      expect((result as ValidationError).errors[0].field).toBe("start");
      expect((result as ValidationError).errors[0].message).toContain("required");
    });

    it("rejects empty start", () => {
      const result = validateBookingInput(validInput({ start: "" }));
      expect(result.valid).toBe(false);
      expect((result as ValidationError).errors[0].field).toBe("start");
    });

    it("rejects whitespace-only start", () => {
      const result = validateBookingInput(validInput({ start: "   " }));
      expect(result.valid).toBe(false);
      expect((result as ValidationError).errors[0].field).toBe("start");
    });

    it("rejects non-ISO datetime start", () => {
      const result = validateBookingInput(validInput({ start: "January 15, 2024" }));
      expect(result.valid).toBe(false);
      expect((result as ValidationError).errors[0].field).toBe("start");
      expect((result as ValidationError).errors[0].message).toContain("ISO 8601");
    });

    it("rejects invalid date in ISO format", () => {
      const result = validateBookingInput(validInput({ start: "2024-13-45T99:99:99Z" }));
      expect(result.valid).toBe(false);
      expect((result as ValidationError).errors[0].field).toBe("start");
    });

    it("accepts datetime with timezone offset", () => {
      const result = validateBookingInput(validInput({ start: "2024-01-15T10:00:00+05:30" }));
      expect(result).toEqual({ valid: true });
    });

    it("accepts datetime without trailing Z", () => {
      const result = validateBookingInput(validInput({ start: "2024-01-15T10:00:00" }));
      expect(result).toEqual({ valid: true });
    });
  });

  describe("end validation", () => {
    it("rejects empty end when provided", () => {
      const result = validateBookingInput(validInput({ end: "" }));
      expect(result.valid).toBe(false);
      expect((result as ValidationError).errors[0].field).toBe("end");
    });

    it("rejects non-ISO end", () => {
      const result = validateBookingInput(validInput({ end: "not-a-date" }));
      expect(result.valid).toBe(false);
      expect((result as ValidationError).errors[0].field).toBe("end");
      expect((result as ValidationError).errors[0].message).toContain("ISO 8601");
    });

    it("rejects end before start", () => {
      const result = validateBookingInput(
        validInput({
          start: "2024-01-15T10:00:00Z",
          end: "2024-01-15T09:00:00Z",
        })
      );
      expect(result.valid).toBe(false);
      expect((result as ValidationError).errors[0].field).toBe("end");
      expect((result as ValidationError).errors[0].message).toContain("after start");
    });

    it("accepts end equal to start (zero-length events)", () => {
      const result = validateBookingInput(
        validInput({
          start: "2024-01-15T10:00:00Z",
          end: "2024-01-15T10:00:00Z",
        })
      );
      expect(result).toEqual({ valid: true });
    });
  });

  describe("language validation", () => {
    it("rejects missing language", () => {
      const result = validateBookingInput(validInput({ language: undefined }));
      expect(result.valid).toBe(false);
      expect((result as ValidationError).errors[0].field).toBe("language");
      expect((result as ValidationError).errors[0].message).toContain("required");
    });

    it("rejects empty language", () => {
      const result = validateBookingInput(validInput({ language: "" }));
      expect(result.valid).toBe(false);
      expect((result as ValidationError).errors[0].field).toBe("language");
    });

    it("rejects non-string language", () => {
      const result = validateBookingInput(validInput({ language: 123 }));
      expect(result.valid).toBe(false);
      expect((result as ValidationError).errors[0].field).toBe("language");
    });
  });

  describe("timeZone validation", () => {
    it("rejects missing timeZone", () => {
      const result = validateBookingInput(validInput({ timeZone: undefined }));
      expect(result.valid).toBe(false);
      expect((result as ValidationError).errors[0].field).toBe("timeZone");
      expect((result as ValidationError).errors[0].message).toContain("IANA timezone");
    });

    it("rejects empty timeZone", () => {
      const result = validateBookingInput(validInput({ timeZone: "" }));
      expect(result.valid).toBe(false);
      expect((result as ValidationError).errors[0].field).toBe("timeZone");
    });
  });

  describe("metadata validation", () => {
    it("rejects null metadata", () => {
      const result = validateBookingInput(validInput({ metadata: null }));
      expect(result.valid).toBe(false);
      expect((result as ValidationError).errors[0].field).toBe("metadata");
      expect((result as ValidationError).errors[0].message).toContain("JSON object");
    });

    it("rejects undefined metadata", () => {
      const result = validateBookingInput(validInput({ metadata: undefined }));
      expect(result.valid).toBe(false);
      expect((result as ValidationError).errors[0].field).toBe("metadata");
    });

    it("rejects array metadata", () => {
      const result = validateBookingInput(validInput({ metadata: [] }));
      expect(result.valid).toBe(false);
      expect((result as ValidationError).errors[0].field).toBe("metadata");
    });

    it("rejects string metadata", () => {
      const result = validateBookingInput(validInput({ metadata: "not-an-object" }));
      expect(result.valid).toBe(false);
      expect((result as ValidationError).errors[0].field).toBe("metadata");
    });

    it("accepts empty object metadata", () => {
      const result = validateBookingInput(validInput({ metadata: {} }));
      expect(result).toEqual({ valid: true });
    });

    it("accepts populated metadata", () => {
      const result = validateBookingInput(validInput({ metadata: { key: "value" } }));
      expect(result).toEqual({ valid: true });
    });
  });

  describe("rescheduleUid validation", () => {
    it("rejects empty rescheduleUid when provided", () => {
      const result = validateBookingInput(validInput({ rescheduleUid: "" }));
      expect(result.valid).toBe(false);
      expect((result as ValidationError).errors[0].field).toBe("rescheduleUid");
    });

    it("rejects whitespace-only rescheduleUid", () => {
      const result = validateBookingInput(validInput({ rescheduleUid: "   " }));
      expect(result.valid).toBe(false);
      expect((result as ValidationError).errors[0].field).toBe("rescheduleUid");
    });
  });

  describe("rescheduledBy validation", () => {
    it("rejects invalid email for rescheduledBy", () => {
      const result = validateBookingInput(validInput({ rescheduledBy: "not-an-email" }));
      expect(result.valid).toBe(false);
      expect((result as ValidationError).errors[0].field).toBe("rescheduledBy");
      expect((result as ValidationError).errors[0].message).toContain("valid email");
    });

    it("rejects empty rescheduledBy when provided", () => {
      const result = validateBookingInput(validInput({ rescheduledBy: "" }));
      expect(result.valid).toBe(false);
      expect((result as ValidationError).errors[0].field).toBe("rescheduledBy");
    });
  });

  describe("multiple errors", () => {
    it("collects all validation errors at once", () => {
      const result = validateBookingInput({
        eventTypeId: -1,
        start: "",
        language: "",
        timeZone: "",
        metadata: null,
      });
      expect(result.valid).toBe(false);
      const errors = (result as ValidationError).errors;
      expect(errors.length).toBeGreaterThanOrEqual(5);

      const fields = errors.map((e) => e.field);
      expect(fields).toContain("eventTypeId");
      expect(fields).toContain("start");
      expect(fields).toContain("language");
      expect(fields).toContain("timeZone");
      expect(fields).toContain("metadata");
    });
  });
});

describe("assertValidBookingInput", () => {
  it("does not throw for valid input", () => {
    expect(() => assertValidBookingInput(validInput())).not.toThrow();
  });

  it("throws ErrorWithCode for invalid input", () => {
    expect(() => assertValidBookingInput(validInput({ eventTypeId: -1 }))).toThrow(ErrorWithCode);
  });

  it("throws with RequestBodyInvalid code", () => {
    try {
      assertValidBookingInput(validInput({ eventTypeId: -1 }));
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorWithCode);
      expect((error as ErrorWithCode).code).toBe(ErrorCode.RequestBodyInvalid);
    }
  });

  it("includes field-level errors in the error data", () => {
    try {
      assertValidBookingInput(validInput({ eventTypeId: "bad", start: "" }));
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorWithCode);
      const ewc = error as ErrorWithCode;
      expect(ewc.data).toBeDefined();
      const validationErrors = ewc.data?.validationErrors as Array<{ field: string; message: string }>;
      expect(validationErrors.length).toBeGreaterThanOrEqual(2);
      expect(validationErrors.some((e) => e.field === "eventTypeId")).toBe(true);
      expect(validationErrors.some((e) => e.field === "start")).toBe(true);
    }
  });

  it("includes a human-readable summary in the error message", () => {
    try {
      assertValidBookingInput(validInput({ language: "" }));
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorWithCode);
      expect((error as ErrorWithCode).message).toContain("language");
      expect((error as ErrorWithCode).message).toContain("Invalid booking input");
    }
  });
});
