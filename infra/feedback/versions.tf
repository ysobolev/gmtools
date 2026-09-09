terraform {
  required_version = ">= 1.11.2, < 2.0.0"

  # Set AWS_ENDPOINT_URL_S3 to the account's R2 endpoint; credentials use AWS_* env vars.
  backend "s3" {
    bucket                      = "gmtools-tfstate"
    key                         = "gmtools/feedback/terraform.tfstate"
    region                      = "auto"
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true
    use_path_style              = true
    use_lockfile                = true
  }

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "5.24.0"
    }
  }
}

# Uses CLOUDFLARE_API_TOKEN; never put credentials in configuration.
provider "cloudflare" {}
