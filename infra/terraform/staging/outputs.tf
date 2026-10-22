output "public_url" {
  description = "Load balancer URL for the dashboard; the API is under /v1 on the same host."
  value       = local.public_url
}

output "ecr_repositories" {
  value = { for k, r in aws_ecr_repository.app : k => r.repository_url }
}

output "ecs_cluster" {
  value = aws_ecs_cluster.main.name
}

output "migrate_command" {
  description = "One-off task that applies database migrations and the demo seed with the current API image."
  value = join(" ", [
    "aws ecs run-task --region ${var.region} --cluster ${aws_ecs_cluster.main.name}",
    "--launch-type FARGATE --task-definition ${aws_ecs_task_definition.api.family}",
    "--network-configuration 'awsvpcConfiguration={subnets=[${join(",", aws_subnet.public[*].id)}],securityGroups=[${aws_security_group.app.id}],assignPublicIp=ENABLED}'",
    "--overrides '{\"containerOverrides\":[{\"name\":\"api\",\"command\":[\"sh\",\"-c\",\"node_modules/.bin/prisma migrate deploy && node dist/prisma/seed.js\"]}]}'",
  ])
}
