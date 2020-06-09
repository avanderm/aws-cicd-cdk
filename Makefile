deploy = npm run cdk deploy -- \
	-a bin/cicd-cdk.js $(1) \
	-o $(BUILD_DIR) \
	-c dockerRepository=$(DOCKER_REPOSITORY) \
	-c cdkRepository=$(CDK_REPOSITORY) \
	-c githubTokenParameter=$(GITHUB_TOKEN) \
	-c owner=$(OWNER) \
	-c artifactBucket=$(ARTIFACT_BUCKET) \
	-c vpc=$(VPC_ID) \
	-c subnets=$(SUBNET_IDS) \
	-c availabilityZones=$(AVAILABILITY_ZONES)

synth = npm run cdk synth -- \
	-a bin/cicd-cdk.js $(1) \
	-o $(BUILD_DIR) \
	-c dockerRepository=$(DOCKER_REPOSITORY) \
	-c cdkRepository=$(CDK_REPOSITORY) \
	-c githubTokenParameter=$(GITHUB_TOKEN) \
	-c owner=$(OWNER) \
	-c artifactBucket=$(ARTIFACT_BUCKET) \
	-c vpc=$(VPC_ID) \
	-c subnets=$(SUBNET_IDS) \
	-c availabilityZones=$(AVAILABILITY_ZONES)

delete = npm run cdk destroy -- -a bin/cicd-cdk.js $(1)

deploy:
	$(call deploy,$(STACK))

synth:
	$(call synth,$(STACK))

delete:
	$(call delete,$(STACK))