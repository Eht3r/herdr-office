const secretName =
  "(?:[A-Z][A-Z0-9_]*(?:_KEY|_TOKEN|_SECRET|_PASSWORD|_CREDENTIALS?)|TOKEN|API_KEY|SECRET|PASSWORD|PASSWD|AUTHORIZATION|DATABASE_URL|PRIVATE_KEY)";

export function redact(text: string): string {
  return text
    .replace(
      /-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----[\s\S]*?-----END \1-----/g,
      "[REDACTED]",
    )
    .replace(/([a-z][a-z\d+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDACTED]@")
    .replace(
      new RegExp(
        `(["']?\\b${secretName}\\b["']?\\s*[:=]\\s*)(?:"[^"\\r\\n]*"|'[^'\\r\\n]*'|(?:Bearer\\s+)?[^\\s,;}&]+)`,
        "gi",
      ),
      "$1[REDACTED]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(
      /\b(?:sk-(?:proj-)?[\w-]{12,}|gh[pousr]_[\w]{12,}|github_pat_[\w]{12,}|xox[baprs]-[\w-]{10,}|AKIA[A-Z0-9]{16}|eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+)\b/g,
      "[REDACTED]",
    );
}
