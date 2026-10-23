export type ErrorDetails = Readonly<Record<string, unknown>>;

export class AppError extends Error {
  readonly code: string;
  readonly exitCode: number;
  readonly details: ErrorDetails;

  constructor(
    message: string,
    options: {
      code: string;
      exitCode?: number;
      details?: ErrorDetails;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.code = options.code;
    this.exitCode = options.exitCode ?? 1;
    this.details = options.details ?? {};
  }
}

export class InputError extends AppError {
  constructor(message: string, details?: ErrorDetails) {
    super(message, {
      code: "INVALID_INPUT",
      exitCode: 2,
      ...(details === undefined ? {} : { details }),
    });
  }
}

export class OutputExistsError extends AppError {
  constructor(path: string) {
    super(`Refusing to overwrite existing output: ${path}`, {
      code: "OUTPUT_EXISTS",
      exitCode: 3,
      details: { path },
    });
  }
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof Error) {
    return new AppError(error.message, {
      code: "UNEXPECTED_ERROR",
      cause: error,
    });
  }
  return new AppError("An unknown error occurred.", {
    code: "UNEXPECTED_ERROR",
    details: { value: String(error) },
  });
}
