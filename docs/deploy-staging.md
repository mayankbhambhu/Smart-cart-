# Deploying staging to AWS (ap-south-1)

Nothing in this repo deploys automatically. CI only validates the Terraform. Applying it creates
billable AWS resources, so do it deliberately.

## What gets created

`infra/terraform/staging` creates, in Mumbai (ap-south-1):

| Resource | Size | Rough cost |
| --- | --- | --- |
| VPC, 2 public + 2 private subnets, no NAT gateway | | free |
| Application Load Balancer (HTTP for now) | 1 | about USD 18 a month |
| ECS Fargate: API + dashboard | 2 tasks, 0.25 vCPU / 0.5 GB each | about USD 18 a month |
| RDS PostgreSQL 16 | db.t4g.micro, 20 GB | about USD 15 a month |
| ElastiCache Redis 7 | cache.t4g.micro | about USD 12 a month |
| ECR (2 repos), CloudWatch logs (14 days), Secrets Manager (1 secret) | | a few dollars |

Roughly USD 65 to 75 a month (about ₹5,500 to ₹6,500) if left running; new AWS accounts may get some
of this in the free tier. Costs are estimates; check the AWS pricing calculator. `terraform destroy`
removes everything.

## Steps

You need the AWS CLI signed in to the staging account (`aws sts get-caller-identity`) with
permission to create the resources above. Credentials stay on your machine; never commit them or
paste them into chat.

```sh
cd infra/terraform/staging
terraform init
terraform plan          # read what it will create
terraform apply         # creates the stack; the services will not be healthy until images exist
```

Build and push the images (Terraform prints the ECR URLs as `ecr_repositories`):

```sh
aws ecr get-login-password --region ap-south-1 | docker login --username AWS --password-stdin <account>.dkr.ecr.ap-south-1.amazonaws.com
docker build -f apps/api/Dockerfile -t <api-repo-url>:latest .
docker build -f apps/dashboard/Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=$(terraform -chdir=infra/terraform/staging output -raw public_url) \
  -t <dashboard-repo-url>:latest .
docker push <api-repo-url>:latest
docker push <dashboard-repo-url>:latest
```

Set the Stripe secrets once (test-mode keys for staging). Type them into your own terminal, never
into chat, a file in the repo, or tfvars:

```sh
aws secretsmanager put-secret-value --region ap-south-1 --secret-id smart-cart-staging/stripe \
  --secret-string '{"secret_key":"sk_test_...","webhook_secret":"whsec_..."}'
```

In the Stripe dashboard (test mode), add a webhook endpoint `<public_url>/v1/payments/stripe/webhook`
for `payment_intent.succeeded` and `payment_intent.payment_failed`; its signing secret is the
`webhook_secret` above.

Then run migrations and the demo seed once (the exact command is the `migrate_command` output), and
force new deployments:

```sh
aws ecs update-service --cluster smart-cart-staging --service api --force-new-deployment
aws ecs update-service --cluster smart-cart-staging --service dashboard --force-new-deployment
```

Open the `public_url` output for the dashboard; `<public_url>/readyz` checks the API.

## Before real shoppers (pilot)

- Domain and ACM certificate, HTTPS listener, redirect HTTP to HTTPS.
- Admin routes behind staff sign-in (milestone 2).
- Stripe live mode: live INR payments need a Stripe account registered in India (invite only at the
  time of writing). If that is not available for the pilot, add the Razorpay adapter behind the
  same `PaymentProvider` interface; test mode works either way.
- RDS deletion protection, Multi-AZ, longer backups; a remote Terraform state bucket.
- Separate pilot environment directory with larger sizes and 2 API tasks.
