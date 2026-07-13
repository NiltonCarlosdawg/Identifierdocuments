export class Email {
  private constructor(private readonly value: string) {
    if (!Email.isValid(value)) throw new Error(`Email inválido: ${value}`);
  }
  static create(email: string): Email { return new Email(email.trim().toLowerCase()); }
  static isValid(email: string): boolean { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
  toString(): string { return this.value; }
}
