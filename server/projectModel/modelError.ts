export class ModelError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
