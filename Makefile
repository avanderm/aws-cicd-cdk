deploy-ecr:
	cdk deploy -a bin/cicd-cdk.js DockerPipeline \
		-c dockerRepository=$(DOCKER_REPOSITORY) \
		-c cdkRepository=$(CDK_REPOSITORY) \
		-c owner=$(OWNER) \
		-c branch=$(DOCKER_BRANCH) \
		-c artifactBucket=$(ARTIFACT_BUCKET)

deploy-ecs:
	cdk deploy -a bin/cicd-cdk.js DeployPipeline \
		-c dockerRepository=$(DOCKER_REPOSITORY) \
		-c cdkRepository=$(CDK_REPOSITORY) \
		-c owner=$(OWNER) \
		-c branch=$(DOCKER_BRANCH) \
		-c artifactBucket=$(ARTIFACT_BUCKET)

deploy-cdk:
	cdk deploy -a bin/cicd-cdk.js CdkPipeline \
		-c dockerRepository=$(DOCKER_REPOSITORY) \
		-c cdkRepository=$(CDK_REPOSITORY) \
		-c owner=$(OWNER) \
		-c branch=$(DOCKER_BRANCH) \
		-c artifactBucket=$(ARTIFACT_BUCKET)

delete-ecr:
	cdk destroy -a bin/cicd-cdk.js DockerPipeline

delete-ecs:
	cdk destroy -a bin/cicd-cdk.js DeployPipeline