# Feedback infrastructure

The Worker is a placeholder returning HTTP 503 without touching R2. The
extension remains export-only; upload support is a separate change.

## Layout and resources

- Source: `src/feedback-worker/index.ts`; tests: `tests/feedback-worker.test.mjs`.
- `pnpm feedback:build` independently typechecks and bundles the Worker to
  `generated/feedback-worker/index.js`; `pnpm build` also builds it. Terraform deploys
  that file, tracking its SHA-256. Build before planning, not between plan and apply.
- Private Standard R2 feedback bucket: 90-day expiration, one-day multipart cleanup,
  and `prevent_destroy`.
- Worker with a `FEEDBACK_BUCKET` bucket binding and public `workers.dev` endpoint.
  Preview URLs are disabled; the bucket itself is not public.

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

## Future upload contract

Not implemented by the placeholder:

- Maximum 50 MiB per JSON report including base64, at most five images, and the
  existing per-image size/type limits.
- Server-generated object keys; no public read/list/overwrite/delete operations.
- Streaming size enforcement, schema validation, throttling, and a kill switch.
  Per-report limits alone do not bound total spend.
- No logging report bodies, images, or credentials. Development remains export-only.

## References

- [R2 Terraform backend](https://developers.cloudflare.com/terraform/advanced-topics/remote-backend/)
- [S3 backend and locking](https://developer.hashicorp.com/terraform/language/backend/s3)
- [Cloudflare provider](https://registry.terraform.io/providers/cloudflare/cloudflare/5.24.0/docs)
