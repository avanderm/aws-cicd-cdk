deploy = cdk deploy -a bin/cicd-cdk.js $(1) \
	-c dockerRepository=$(DOCKER_REPOSITORY) \
	-c cdkRepository=$(CDK_REPOSITORY) \
	-c owner=$(OWNER) \
	-c artifactBucket=$(ARTIFACT_BUCKET) \
	-c vpc=$(VPC_ID) \
	-c subnets=$(SUBNET_IDS) \
	-c availabilityZones=$(AVAILABILITY_ZONES)

synth = cdk synth -a bin/cicd-cdk.js $(1) \
	-c dockerRepository=$(DOCKER_REPOSITORY) \
	-c cdkRepository=$(CDK_REPOSITORY) \
	-c owner=$(OWNER) \
	-c artifactBucket=$(ARTIFACT_BUCKET) \
	-c vpc=$(VPC_ID) \
	-c subnets=$(SUBNET_IDS) \
	-c availabilityZones=$(AVAILABILITY_ZONES)

delete = cdk destroy -a bin/cicd-cdk.js $(1)

delete = cdk destroy -a bin/cicd-cdk.js $(1)

deploy:
	$(call deploy,$(STACK))

synth:
	$(call synth,$(STACK))

delete:
	$(call delete,$(STACK))