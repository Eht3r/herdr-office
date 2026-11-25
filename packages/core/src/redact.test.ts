import { expect, it } from "vitest";
import { redact } from "./redact.ts";

it("masks assignments, bearer tokens, URL credentials and known standalone tokens", () => {
  const result = redact(
    [
      'SERVICE_API_KEY="example secret"',
      "Authorization: Bearer fake.token.123",
      "fetch https://test-user:fake-pass@example.test/path",
      "ghp_abcdefghijklmnop",
      "DATABASE_URL=postgres://test-user:fake-pass@example.test/db",
      "PORT=3000",
    ].join("\n"),
  );
  expect(result).toBe(
    [
      "SERVICE_API_KEY=[REDACTED]",
      "Authorization: [REDACTED]",
      "fetch https://[REDACTED]@example.test/path",
      "[REDACTED]",
      "DATABASE_URL=[REDACTED]",
      "PORT=3000",
    ].join("\n"),
  );
});

it("masks multiline private keys", () => {
  expect(
    redact(
      "-----BEGIN TEST PRIVATE KEY-----\nexample\n-----END TEST PRIVATE KEY-----",
    ),
  ).toBe("[REDACTED]");
});
