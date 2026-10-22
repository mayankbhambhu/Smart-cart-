variable "region" {
  type    = string
  default = "ap-south-1" # Mumbai
}

variable "environment" {
  type    = string
  default = "staging"
}

variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "api_image_tag" {
  description = "Tag of the API image in ECR to run."
  type        = string
  default     = "latest"
}

variable "dashboard_image_tag" {
  description = "Tag of the dashboard image in ECR to run."
  type        = string
  default     = "latest"
}

variable "api_desired_count" {
  type    = number
  default = 1
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "redis_node_type" {
  type    = string
  default = "cache.t4g.micro"
}
