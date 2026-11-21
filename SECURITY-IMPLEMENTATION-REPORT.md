# Kalaai security and production-readiness implementation report

Implementation date: 16 November 2026

## Project inspected

- Frontend: vanilla JavaScript single-page storefront (`src.js`), HTML entry point and CSS.
- Backend: Node.js 18+ with Express 4.
- Persistence: MongoDB through Mongoose.
- Admin authentication: bcryptjs password comparison, JWT session in an HttpOnly cookie.
- Existing customer features: catalogue, cart, wishlist, order-request API, custom enquiry API and contact enquiry API.
- No customer registration, payment gateway, analytics SDK, email provider, shipping integration or customer self-service account area was present in the supplied archive.

## Implemented in this code revision

- Added branded Privacy Policy and Terms & Conditions pages and footer links. Unconfirmed business/legal details and business policies are visibly marked for owner completion.
- Added cookie preference banner with Accept All, Reject Optional and Manage Preferences. Preferences are stored in browser local storage. No optional analytics or marketing scripts are installed or activated by this project.
- Added production HTTPS redirect, production-only HSTS, Secure/HttpOnly/SameSite=Strict admin cookie, JWT issuer/audience/algorithm checks, session expiry and logout cookie clearing.
- Added Helmet CSP and browser security headers. `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `nosniff`, Referrer-Policy and Permissions-Policy are configured.
- Added request-origin checks for state-changing requests, bounded JSON/form request sizes, API 404 handling and safe generic server error responses.
- Added server-side validation and length limits for order, enquiry and product inputs; server-calculated order prices; local-only image path checks; and safer storefront output escaping for catalogue and customer-entered personalisation text.
- Added public form rate limiting, honeypot fields and short-window duplicate submission suppression.
- Added admin API authentication and role claim verification, write-request throttling, strict status allow-lists and validated record identifiers.
- Removed the hard-coded admin username default from the login UI and changed `.env.example` to non-working placeholders.
- Blocked direct static access to server source/configuration paths and package/README files.
- Added dynamic `robots.txt` and `sitemap.xml`, configurable canonical URL and page-specific titles/descriptions, Open Graph updates, and no-index behavior for the admin page/private route types.
- Added branded custom 404 page, visible keyboard focus styles, additional image alt text and accessible labels for key icon/quantity controls.
- Added basic API/static caching headers for public catalogue/assets; admin responses are marked no-store.

## Files created

- `public/404.html`
- `SECURITY-IMPLEMENTATION-REPORT.md`

## Files modified

- `.env.example`
- `README.md`
- `index.html`
- `src.js`
- `styles.css`
- `server/index.js`
- `server/middleware.js`
- `public/admin.js`

No database migration was added and existing MongoDB collections/data are not intentionally altered.

## Dependencies

No new third-party dependency was added. The project already declares Express, Helmet, express-rate-limit, Mongoose, bcryptjs, jsonwebtoken, cookie-parser and dotenv.

## Required environment configuration

- `MONGODB_URI`: use a dedicated least-privilege MongoDB database user, restrict network access and use TLS.
- `ADMIN_USERNAME`: unique administrator username.
- `ADMIN_PASSWORD`: unique strong password (minimum 14 characters enforced in production).
- `JWT_SECRET`: unique random secret of at least 32 characters.
- `SITE_URL`: canonical public HTTPS origin (required in production; used for HTTPS redirects, canonical URLs and sitemap).
- `NODE_ENV=production`.
- `TRUST_PROXY=true` only if deployed behind a trusted reverse proxy that correctly sets forwarded headers; otherwise leave false.
- Optional `PORT` and `SESSION_DAYS` (session length is capped at seven days).

## Owner/legal approval required

- Legal/business entity name, privacy contact email and postal/business address.
- Actual hosting and database providers, processing locations and any applicable cross-border processing disclosures.
- Retention period, deletion workflow, backup retention and privacy-request handling procedure.
- Applicable privacy-law notices and final review by a qualified adviser.
- Governing law, jurisdiction and dispute-resolution process.
- Accepted payment methods, cancellation/refund/return policy, shipping areas/costs/timelines, custom-order terms, design proof/revision policy and order acceptance rules.
- Final product prices, availability and catalogue statements currently marked as sample/illustrative.

## Validation performed

- `node --check server/index.js`: passed.
- `node --check server/middleware.js`: passed.
- `node --check src.js`: passed.
- `node --check public/admin.js`: passed.
- Source archive inspected; framework, routes, models, forms, static assets and existing authentication flow reviewed.
- Dependency installation was attempted but timed out in this environment. Therefore the app could not be launched here and no live HTTP, MongoDB, browser, mobile, login, form-submission or header integration tests are claimed as passed.

## Known limitations / remaining risks

- Storefront controls now use delegated event listeners rather than inline event attributes, so the CSP does not allow inline script execution. Razorpay checkout is restricted to test-mode keys until a separately reviewed live-payment configuration is implemented.
- Rate limiting and duplicate suppression use in-memory stores. They reset on restart and are not shared across multiple app instances. Use a maintained Redis-backed store for horizontally scaled production deployments.
- CAPTCHA is not configured. Honeypot, rate limits, validation and duplicate suppression are the current low-friction anti-spam controls; add a privacy-reviewed challenge only if abuse warrants it.
- Database least-privilege permissions, encryption-at-rest, network allowlists, backups, restore drills and monitoring must be configured in the MongoDB/hosting provider consoles.
- No automatic retention/deletion workflow or customer data export feature exists yet.
- No optional tracking scripts exist. If analytics/marketing services are added later, their loading must be explicitly gated by the saved consent state and the Privacy Policy updated.
- HTTPS certificate issuance, reverse-proxy configuration and live HSTS verification cannot be completed from a source ZIP.
- Existing catalogue image files are served as supplied; no lossy image recompression or generated responsive variants were made to avoid altering artwork quality. Most below-the-fold product images already use lazy loading.
- There is one administrator role configured from environment variables; there is no multi-user role/permission management, MFA or self-service password reset.
- A static source review cannot guarantee the absence of all vulnerabilities. Run dependency scanning, a production DAST/security-header scan and a manual accessibility/mobile review before launch.

## Manual production checklist

1. Configure all environment variables and replace all example credentials.
2. Configure TLS and the reverse proxy; set `TRUST_PROXY=true` only when appropriate.
3. Create a dedicated MongoDB user with only the required database permissions; restrict network access and enable backups/restore testing.
4. Set the real `SITE_URL` and verify redirects, canonical URLs, sitemap and robots output.
5. Complete and approve all legal placeholders and business policies.
6. Confirm that the website's customer-facing contact details, prices, availability, delivery and returns statements are accurate.
7. Run browser tests for cart, wishlist, orders, enquiries, admin login/logout and access denial; verify mobile layouts and keyboard/screen-reader flows.
8. Verify production headers and cookies over HTTPS, test backup restoration, and monitor rate limits/errors.
9. Before integrating analytics, advertising, payments, email or shipping vendors, document the data flows, update disclosures and implement consent/verification controls.
