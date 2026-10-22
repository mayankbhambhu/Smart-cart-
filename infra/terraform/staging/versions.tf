terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # State lives locally until a state bucket exists. To share state, create an S3 bucket
  # (versioned, encrypted) and run: terraform init -backend-config=backend.hcl
  # with backend.hcl based on backend.hcl.example, after uncommenting the block below.
  # backend "s3" {}
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = "smart-cart"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
