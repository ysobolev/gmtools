mock_provider "cloudflare" {}

variables {
  account_id = "00000000000000000000000000000000"
}

run "private_feedback_recipe" {
  command = plan

  assert {
    condition = (
      cloudflare_workers_script.feedback.observability.enabled &&
      cloudflare_workers_script.feedback.observability.logs.enabled &&
      cloudflare_workers_script.feedback.observability.logs.persist &&
      cloudflare_workers_script.feedback.observability.logs.invocation_logs &&
      cloudflare_workers_script.feedback.observability.traces.enabled &&
      cloudflare_workers_script.feedback.observability.traces.persist
    )
    error_message = "Persist Worker logs, invocation metadata, and traces."
  }

  assert {
    condition     = cloudflare_workers_script.feedback.content_sha256 == filesha256("${path.module}/../../generated/feedback-worker/index.js")
    error_message = "Deploy the generated Worker bundle and track changes by its hash."
  }

  assert {
    condition     = cloudflare_r2_bucket_lifecycle.feedback.rules[0].delete_objects_transition.condition.max_age == 7776000
    error_message = "Feedback must expire after 90 days by default."
  }

  assert {
    condition     = cloudflare_workers_script.feedback.bindings[0].bucket_name == cloudflare_r2_bucket.feedback.name
    error_message = "The Worker must bind the feedback bucket."
  }

  assert {
    condition     = cloudflare_workers_script_subdomain.feedback.enabled
    error_message = "The Worker must be reachable through workers.dev."
  }
}

run "reject_invalid_retention" {
  command = plan
  variables {
    retention_days = 0
  }
  expect_failures = [var.retention_days]
}

run "disable_uploads" {
  command = plan
  variables {
    uploads_enabled = false
  }
  assert {
    condition = one([
      for binding in cloudflare_workers_script.feedback.bindings : binding.text
      if binding.name == "FEEDBACK_UPLOADS_ENABLED"
    ]) == "false"
    error_message = "Disabling uploads must reach the Worker kill switch."
  }
}
