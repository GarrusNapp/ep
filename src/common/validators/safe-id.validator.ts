import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

export const SAFE_ID_PATTERN = /^(?!\.+$)[a-zA-Z0-9._-]{1,255}$/;

export const isSafeId = (value: unknown): boolean =>
  typeof value === 'string' && SAFE_ID_PATTERN.test(value);

@ValidatorConstraint({ name: 'SafeId', async: false })
class SafeIdConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isSafeId(value);
  }

  defaultMessage(): string {
    return 'must be a safe identifier (no "/", no dot-only segments)';
  }
}

export function IsSafeId(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: SafeIdConstraint,
    });
  };
}
