# Useful commands

 * `npm run build`   compile typescript to js
 * `npm run watch`   watch for changes and compile
 * `npm run test`    perform the jest unit tests
 * `cdk deploy`      deploy this stack to your default AWS account/region
 * `cdk diff`        compare deployed stack with current state
 * `cdk synth`       emits the synthesized CloudFormation template

# AWS CI/CD CDK

Test repository for CI/CD of CDK on AWS. This repo is used in conjunction with the [AWS CI/CD Docker](https://github.com/avanderm/aws-cicd-docker) repo.

## Position in CI/CD

This repo will deploy three stacks and one nested stack:
- The CI/CD pipeline listening to the [AWS CI/CD Docker](https://github.com/avanderm/aws-cicd-docker) repository, building and pushing the image tagged with `latest` to ECR.
- The main stack takes a configuration file (e.g. [test.yml](config/test.yml)) and use it to deploy ECS services running the code from the [AWS CI/CD Docker](https://github.com/avanderm/aws-cicd-docker) repo. The configuration file will help set environment variables or can even be used to deploy a specific tagged image.
  - The main stack contains a nested stack with a CI/CD pipeline, listening to changes in the ECR repo for the image tagged as `latest`. When triggered the ECS services from the main stack are re-deployed with the new image.
- The CI/CD pipeline listening to this repo; it will self update the CI/CD pipeline before updating both the ECR pipeline and the main stack.