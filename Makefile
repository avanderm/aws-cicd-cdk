deploy-ecr:
	cdk deploy -a bin/cicd-cdk.js DockerPipeline \
		-c repository=$(DOCKER_REPOSITORY) \
		-c owner=$(OWNER) \
		-c branch=$(DOCKER_BRANCH) \
		-c artifactBucket=$(ARTIFACT_BUCKET)

deploy-ecs:
	cdk deploy -a bin/cicd-cdk.js DeployPipeline \
		-c repository=$(DOCKER_REPOSITORY) \
		-c owner=$(OWNER) \
		-c branch=$(DOCKER_BRANCH) \
		-c artifactBucket=$(ARTIFACT_BUCKET)

delete-ecr:
	cdk destroy -a bin/cicd-cdk.js DockerPipeline

delete-ecs:
	cdk destroy -a bin/cicd-cdk.js DeployPipeline