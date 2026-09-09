variable "account_id" {
  description = "Cloudflare account hosting the feedback service."
  type        = string
  validation {
    condition     = can(regex("^[a-f0-9]{32}$", var.account_id))
    error_message = "Use the 32-character Cloudflare account ID."
  }
}

variable "bucket_name" {
  description = "Private feedback bucket."
  type        = string
  default     = "gmtools-feedback"
}

variable "worker_name" {
  type    = string
  default = "gmtools-feedback"
}

variable "retention_days" {
  description = "Automatically expire feedback, including images."
  type        = number
  default     = 90
  validation {
    condition     = var.retention_days >= 1 && floor(var.retention_days) == var.retention_days
    error_message = "Retention must be a positive whole number of days."
  }
}

variable "uploads_enabled" {
  description = "Accept feedback uploads; false is the service kill switch."
  type        = bool
  default     = true
}
