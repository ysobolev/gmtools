# Feedback infrastructure

The Worker accepts feedback exports at `POST /feedback` and stores them privately
in R2. The extension remains export-only; its upload UI is a separate change.

## Layout and resources

- Source: `src/feedback-worker/index.ts`; tests: `tests/feedback-worker.test.mjs`.
- `pnpm feedback:build` independently typechecks and bundles the Worker to
  `generated/feedback-worker/index.js`; `pnpm build` also builds it. Terraform deploys
  that file, tracking its SHA-256. Build before planning, not between plan and apply.
- Private Standard R2 feedback bucket: 90-day expiration, one-day multipart cleanup,
  and `prevent_destroy`.
- Worker with a `FEEDBACK_BUCKET` bucket binding and public `workers.dev` endpoint.
  Preview URLs are disabled; the bucket itself is not public.
- Upload kill switch: apply with `TF_VAR_uploads_enabled=false` to reject new uploads.
- Rate limits: five attempts per IP per minute and 30 total per minute, each per
  Cloudflare location (not a global spending cap). Namespaces `2026090801` and
  `2026090802` are reserved for these limits. IPs are logged for abuse investigation,
  but are not added to reports stored in R2.

## Bootstrap

1. Create the private `gmtools-tfstate` bucket separately, without expiration.
   Create bucket-scoped R2 Object Read & Write credentials for it and export them
   as `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` environment variables.
2. Register a `workers.dev` account subdomain if needed. Create a Cloudflare API
   token with Workers Scripts Write and Workers R2 Storage Write on the account
   and export it as the `CLOUDFLARE_API_TOKEN` environment variable.
3. Supply `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `CLOUDFLARE_API_TOKEN`, and
   `CLOUDFLARE_ACCOUNT_ID` through the environment. Keep credentials and account ID
   out of tracked files.

Run `pnpm feedback:build` from the repository root, then from `infra/feedback`:

```sh
export AWS_ENDPOINT_URL_S3="https://${CLOUDFLARE_ACCOUNT_ID:?}.r2.cloudflarestorage.com"
export TF_VAR_account_id="$CLOUDFLARE_ACCOUNT_ID"
terraform init
terraform plan -out=feedback.tfplan
terraform apply feedback.tfplan
terraform output -raw worker_url
```

This lets the Worker be deployed and its URL obtained before building the extensions.

## GitHub Actions

Run **Feedback Terraform** manually. Checkout uses the commit resolved for the
workflow's selected ref. `operation` defaults to `plan`; choose `apply` to build,
plan, and apply that saved plan in one run. To run a release tag from the CLI:

```sh
gh workflow run terraform.yml --ref <release-tag> -f operation=plan
```

Create the `feedback-production` GitHub environment with these secrets:
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `CLOUDFLARE_API_TOKEN`, and
`CLOUDFLARE_ACCOUNT_ID`. Configure environment approval/branch rules as desired.
Only select trusted code, since Terraform runs it with production credentials.

Runs are serialized without cancelling an active deployment. Plans/state are not
uploaded as artifacts. The workflow logs the resolved commit and, after apply,
the Worker URL.

## Validation

Run `pnpm test` from the repository root, then from this directory:

```sh
# Fresh checkout only; skip if already initialized:
terraform init -backend=false
terraform fmt -check
terraform validate
terraform test
```

Tests use a mocked provider and leave existing backend initialization unchanged.
If the backend has never been initialized, run `terraform init` with the environment
above before planning or deploying.

## Upload API

Submit an exported version 1 `gmtools-feedback` JSON file:

```sh
curl --fail-with-body -X POST \
  "$(terraform output -raw worker_url)/feedback" \
  -H 'Content-Type: application/json' \
  --data-binary @/path/to/exported-feedback.json
```

Use a synthetic report for smoke tests rather than private campaign data.

- `201`: stored, returning a server-generated `reportId` and `receivedAt` timestamp.
  Keys are flat: `<UTC timestamp>_<UUID>.json`, never client filenames
  (for example, `2026-09-08T21-34-12.123Z_<UUID>.json`).
- `400`: invalid JSON/export/image; `408`: body exceeded the 30-second upload timeout;
  `413`: size/count limit; `415`: unsupported content type/encoding;
  `429`: throttled; `503`: uploads disabled or storage/limiter unavailable.
- Maximum 50 MiB per JSON report including base64; five images; 10 MiB per image.
  PNG, JPEG, GIF, and WebP only. Encoded size and file signatures are checked, not
  full image decoding. Feedback text must be nonempty and at most 100,000 characters.
- An optional `email` address (at most 254 characters) is stored with the report
  for replies. Blank addresses are omitted by the extension.
- Chat/tool/snapshot data is opaque diagnostics, not executed or rendered. Reports
  are private untrusted input; inspect them accordingly. No public read/list/delete
  endpoints and no logging of report bodies, images, or provider errors.
- Workers observability persists sanitized `feedback_response` events with HTTP
  status codes, and `feedback_validation_failed` events for 400/413/415 rejections.
  Events include `payloadBytes` after the full body is read (actual UTF-8 bytes,
  including base64), and `imageCount` after envelope validation. Unknown metrics
  are omitted, including on requests rejected before reading the body.
  Validated reports also log `hasEmail` (boolean only). Successful writes log the
  server-generated `reportId` for correlation with the R2 key. Failures log a
  server-defined `failureCategory` distinguishing JSON/schema/image validation,
  size/count limits, rate limits, and infrastructure failures; no raw errors.
  Custom response events also include the Cloudflare-provided `clientIp`, `rayId`,
  and elapsed `durationMs`; absent IP/Ray headers are omitted. No email addresses
  or report contents are logged. Automatic invocation logs and traces are enabled
  at 100% sampling, including request metadata and platform timing/error details.
  View them in Cloudflare's Worker observability dashboard after deployment.
  Log/trace retention and quotas are separate from the R2 report retention policy.
- `GET /` reports service availability; `OPTIONS /feedback` supports CORS preflight.
  CORS permits anonymous clients; it is not authentication. Limits are best-effort
  abuse protection, not a hard budget. A retry after an ambiguous network failure
  may store another copy; client report IDs are retained for manual correlation.

## References

- [R2 Terraform backend](https://developers.cloudflare.com/terraform/advanced-topics/remote-backend/)
- [S3 backend and locking](https://developer.hashicorp.com/terraform/language/backend/s3)
- [Cloudflare provider](https://registry.terraform.io/providers/cloudflare/cloudflare/5.24.0/docs)
