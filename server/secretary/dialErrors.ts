/** Only failures before the Twilio REST create request are known not to have dialed. */
export class SecretaryPreDialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretaryPreDialError";
  }
}