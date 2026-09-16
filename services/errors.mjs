// EED HALAL — service-layer errors with HTTP-friendly semantics.
// The HTTP layer maps these to status codes WITHOUT parsing messages:
//   ValidationError -> 400, UnauthorizedError -> 401, NotFoundError -> 404,
//   ConflictError   -> 409 (illegal/stale transitions, double actions).

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
  }
}

export class UnauthorizedError extends Error {
  constructor(message = 'unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
    this.statusCode = 401;
  }
}

export class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotFoundError';
    this.statusCode = 404;
  }
}

export class ConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConflictError';
    this.statusCode = 409;
  }
}
