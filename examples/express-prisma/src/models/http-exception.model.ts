// src/models/http-exception.model.ts
export default class HttpException extends Error {
  status: number;
  errors: unknown;

  constructor(status: number, errors: unknown) {
    super();
    this.status = status;
    this.errors = errors;
  }
}
