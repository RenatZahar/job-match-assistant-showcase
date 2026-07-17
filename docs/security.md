# Security and privacy

## Trust model

CVs, vacancies, uploaded files, pasted HTML, provider responses, and all user-entered text are untrusted data. They are never treated as application instructions.

## CV processing boundary

Before external LLM evaluation, the backend:

1. extracts text from supported uploads;
2. normalizes HTML entities, Unicode, invisible characters, and whitespace;
3. removes or converts markup to plain text;
4. replaces sensitive values such as email, phone, address, profile URLs, and candidate name with placeholders;
5. builds a bounded provider request;
6. validates the provider response against the application schema.

Raw CV text is not written to feedback or operational logs. Test-data endpoints are developer tooling and should be used only with synthetic or explicitly sanitized fixtures.

## Secret handling

- Local secrets belong in the ignored root `.env`.
- Browser configuration belongs in `frontend/.env.local`; it must contain only public `VITE_*` values.
- Render and database credentials belong in hosting secret stores.
- LLM and vacancy-provider calls happen only from the backend.
- `.env.example` files contain empty values or non-secret local defaults.

## Persistence

Feedback and app events reject raw CV/vacancy field names before persistence. Database calls use parameterized SQL. The public repository excludes runtime data, logs, raw documents, private test cases, and internal work records.

## Authentication and CORS

If `BASIC_AUTH_USERS` is empty, the local portfolio API uses an anonymous identity. When configured, protected routes require HTTP Basic credentials. This is an MVP control, not a replacement for production identity management.

Set `CORS_ORIGINS` to the exact frontend origins. Avoid wildcard origins when browser credentials are enabled.

## Responsible use

This tool supports human review; it does not make hiring decisions. Match scores and generated explanations can be incomplete or wrong and should be checked against the original vacancy and candidate evidence.

Do not submit real personal data to a third-party model unless you have the legal basis, user consent, and provider retention settings appropriate for that data.
