deploy-ecr:
	cdk deploy -a bin/cicd-cdk.js DockerPipeline -c repository=$(DOCKER_REPOSITORY) -c owner=$(OWNER) -c branch=$(DOCKER_BRANCH)

delete-ecr:
	cdk destroy -a bin/cicd-cdk.js DockerPipeline