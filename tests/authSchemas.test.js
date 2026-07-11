import test from 'node:test';
import assert from 'node:assert/strict';
import { registerSchema, loginSchema, changePasswordSchema } from '../src/validators/schemas.js';

test('register requires email, password and name — matching the signup screen', () => {
  const ok = registerSchema.safeParse({
    email: 'rahmat@example.af', password: 'secret1', name: 'Haji Rahmat'
  });
  assert.equal(ok.success, true);

  assert.equal(registerSchema.safeParse({ password: 'secret1', name: 'X' }).success, false);
  assert.equal(registerSchema.safeParse({ email: 'a@b.af', password: 'secret1' }).success, false);
  assert.equal(registerSchema.safeParse({ email: 'not-an-email', password: 'secret1', name: 'X' }).success, false);
});

test('register normalizes email (trim + lowercase) and no longer requires phone', () => {
  const parsed = registerSchema.parse({
    email: '  Rahmat@Example.AF ', password: 'secret1', name: 'Haji Rahmat'
  });
  assert.equal(parsed.email, 'rahmat@example.af');
  assert.equal(parsed.phone, undefined);
});

test('register enforces the prototype minimum of 6 password characters', () => {
  assert.equal(
    registerSchema.safeParse({ email: 'a@b.af', password: '12345', name: 'X' }).success,
    false
  );
  assert.equal(
    registerSchema.safeParse({ email: 'a@b.af', password: '123456', name: 'X' }).success,
    true
  );
});

test('login is email + password only', () => {
  assert.equal(loginSchema.safeParse({ email: 'a@b.af', password: 'x' }).success, true);
  assert.equal(loginSchema.safeParse({ phone: '+9370', password: 'x' }).success, false);
  assert.equal(loginSchema.safeParse({ email: 'a@b.af' }).success, false);
});

test('change password applies the same 6-char minimum to the new password', () => {
  assert.equal(
    changePasswordSchema.safeParse({ currentPassword: 'old', newPassword: 'short' }).success,
    false
  );
  assert.equal(
    changePasswordSchema.safeParse({ currentPassword: 'old', newPassword: 'longer1' }).success,
    true
  );
});
