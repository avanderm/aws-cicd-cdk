deploy = cdk deploy -a bin/cicd-cdk.js $(1) \
	-c dockerRepository=$(DOCKER_REPOSITORY) \
	-c cdkRepository=$(CDK_REPOSITORY) \
	-c owner=$(OWNER) \
	-c artifactBucket=$(ARTIFACT_BUCKET)

delete = cdk destroy -a bin/cicd-cdk.js $(1)

deploy:
	$(call deploy,$(STACK))

delete:
	$(call delete,$(STACK))