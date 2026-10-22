# One load balancer: API paths go to the API, everything else to the dashboard.
# HTTP only until a domain and ACM certificate exist; add an HTTPS listener before real shoppers.

resource "aws_lb" "main" {
  name               = local.name
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id
  idle_timeout       = 120 # long enough for idle WebSocket connections between pings
}

resource "aws_lb_target_group" "api" {
  name        = "${local.name}-api"
  port        = 4000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    path    = "/readyz"
    matcher = "200"
  }

  # Socket.IO falls back to long polling, which needs the same task for a session.
  stickiness {
    type    = "lb_cookie"
    enabled = true
  }
}

resource "aws_lb_target_group" "dashboard" {
  name        = "${local.name}-dash"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    path    = "/inventory"
    matcher = "200"
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.dashboard.arn
  }
}

resource "aws_lb_listener_rule" "api" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }

  condition {
    path_pattern {
      values = ["/v1/*", "/admin/v1/*", "/healthz", "/readyz", "/socket.io/*"]
    }
  }
}
