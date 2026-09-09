resource "cloudflare_r2_bucket" "feedback" {
  account_id    = var.account_id
  name          = var.bucket_name
  storage_class = "Standard"

  lifecycle {
    prevent_destroy = true
  }
}

# No custom domain or public r2.dev access is enabled.
resource "cloudflare_r2_bucket_lifecycle" "feedback" {
  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.feedback.name
  rules = [{
    id         = "expire-feedback"
    enabled    = true
    conditions = { prefix = "" }
    delete_objects_transition = {
      condition = {
        type    = "Age"
        max_age = var.retention_days * 24 * 60 * 60
      }
    }
    abort_multipart_uploads_transition = {
      condition = { type = "Age", max_age = 86400 }
    }
  }]
}

locals {
  worker_bundle = "${path.module}/../../generated/feedback-worker/index.js"
}

resource "cloudflare_workers_script" "feedback" {
  account_id         = var.account_id
  script_name        = var.worker_name
  compatibility_date = "2026-09-08"
  main_module        = "index.js"
  content_file       = local.worker_bundle
  content_sha256     = filesha256(local.worker_bundle)
  bindings = [{
    name        = "FEEDBACK_BUCKET"
    type        = "r2_bucket"
    bucket_name = cloudflare_r2_bucket.feedback.name
  }]
}

resource "cloudflare_workers_script_subdomain" "feedback" {
  account_id       = var.account_id
  script_name      = cloudflare_workers_script.feedback.script_name
  enabled          = true
  previews_enabled = false
}

data "cloudflare_worker" "feedback" {
  account_id = var.account_id
  worker_id  = cloudflare_workers_script.feedback.script_name

  depends_on = [cloudflare_workers_script_subdomain.feedback]
}

output "worker_url" {
  value = data.cloudflare_worker.feedback.subdomain.url
}
