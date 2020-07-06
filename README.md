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

This is the separate stacks (CodeBuild only) implementation described in the [blog article](https://blog.brainfartlab.com/cdk-cicd/).

## Deploying

Some environment variables need to be set. To define in what AWS account and region to deploy, specify values for `CDK_DEPLOY_ACCOUNT` and `CDK_DEPLOY_REGION`.

The Github repository names need to be passed for `CDK_REPOSITORY` and `DOCKER_REPOSITORY`. Also the Github owner using `GITHUB_OWNER`. The Github token necessary for CodePipeline to pull from Github must be stored in AWS SSM. Pass the parameter name as `GITHUB_TOKEN`.

For CodeBuild to store artifacts it needs access to a S3 bucket, pass it with `ARTIFACT_BUCKET`. A VPC is required for deployment, specify the VPC ID with `VPC_ID`. Provide values for the subnets with `SUBNET_IDS` and the availability zones with `AVAILABILITY_ZONES` using a comma-separated list.

Lastly provide a build directory for the CDK like `cdk.out` using `BUILD_DIR`.

Deploy the CI/CD pipeline using
```bash
STACK=CdkPipeline make deploy
```

The CI/CD pipeline will then deploy all the other stacks. If CodeBuild fails the first time, simply retry. This is due to the IAM CodeBuild policy still being added to CodePipeline while the pipeline is already running.