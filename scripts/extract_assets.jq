[getpath(["artifacts", $stack, "metadata", "/\($stack)"])[] | select(.type == "aws:cdk:asset") | .data]