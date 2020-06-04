deploy = cdk deploy -a bin/cicd-cdk.js $(1) \
	-c dockerRepository=$(DOCKER_REPOSITORY) \
	-c cdkRepository=$(CDK_REPOSITORY) \
	-c owner=$(OWNER) \
	-c artifactBucket=$(ARTIFACT_BUCKET)

delete = cdk destroy -a bin/cicd-cdk.js $(1)
	# -c dockerRepository=$(DOCKER_REPOSITORY) \
	# -c cdkRepository=$(CDK_REPOSITORY) \
	# -c owner=$(OWNER) \
	# -c artifactBucket=$(ARTIFACT_BUCKET)

deploy-permissions:
	$(call deploy,CicdPipelinePermissions)

delete-permissions:
	$(call delete,CicdPipelinePermissions)

deploy-ecr:
	$(call deploy,DockerPipeline)

deploy-ecs:
	$(call deploy,DeployPipeline)

deploy-cdk:
	$(call deploy,CdkPipeline)

delete-ecr:
	$(call delete,DockerPipeline)

delete-ecs:
	$(call delete,DeployPipeline)

delete-cdk:
	$(call delete,CdkPipeline)
