import cdk = require('@aws-cdk/core');
import cfn = require('@aws-cdk/aws-cloudformation');
import codebuild = require('@aws-cdk/aws-codebuild');
import codepipeline = require('@aws-cdk/aws-codepipeline');
import codepipeline_actions = require('@aws-cdk/aws-codepipeline-actions');
import iam = require('@aws-cdk/aws-iam');
import s3 = require('@aws-cdk/aws-s3');

interface CicdCdkStackProps extends cdk.StackProps {
    artifactBucket: s3.Bucket;
    repository: string;
    serviceStacks: Array<cdk.Stack>;
}

export class CicdCdkStack extends cdk.Stack {
    constructor(scope: cdk.Construct, id: string, props: CicdCdkStackProps) {
        super(scope, id, props);

        const cdkBuildProject = new codebuild.PipelineProject(this, 'CDKBuildProject', {
            buildSpec: codebuild.BuildSpec.fromSourceFilename('buildspec.yml'),
            environment: {
                buildImage: codebuild.LinuxBuildImage.UBUNTU_14_04_DOCKER_18_09_0,
                computeType: codebuild.ComputeType.SMALL,
                privileged: true
            }
        });

        const sourceOutput = new codepipeline.Artifact();
        const cdkBuildOutput = new codepipeline.Artifact();

        const consumerDeploymentRole = new iam.Role(this, 'ConsumerDeploymentRole', {
            assumedBy: new iam.ServicePrincipal('cloudformation.amazonaws.com')
        });

        const serviceStackDeployments = []
        for (let serviceStack of props.serviceStacks) {
            serviceStackDeployments.push(
                new codepipeline_actions.CloudFormationCreateUpdateStackAction({
                    actionName: `Update${serviceStack.stackName}`,
                    capabilities: [
                        cfn.CloudFormationCapabilities.ANONYMOUS_IAM
                    ],
                    runOrder: 2,
                    templatePath: cdkBuildOutput.atPath(`${serviceStack.stackName}.template.json`),
                    stackName: serviceStack.stackName,
                    deploymentRole: undefined,
                    adminPermissions: false
                })
            )
        }

        new codepipeline.Pipeline(this, 'Pipeline', {
            artifactBucket: props.artifactBucket,
            stages: [
                {
                    stageName: 'Source',
                    actions: [
                        new codepipeline_actions.GitHubSourceAction({
                            actionName: 'Source',
                            branch: 'master',
                            oauthToken: cdk.SecretValue.secretsManager('github/personal/token'),
                            output: sourceOutput,
                            owner: 'avanderm',
                            repo: props.repository,
                            trigger: codepipeline_actions.GitHubTrigger.WEBHOOK
                        })
                    ]
                },
                {
                    stageName: 'Build',
                    actions: [
                        new codepipeline_actions.CodeBuildAction({
                            actionName: 'CDKBuild',
                            project: cdkBuildProject,
                            input: sourceOutput,
                            outputs: [cdkBuildOutput],
                            environmentVariables: {
                                'CDK_DEPLOY_ACCOUNT': {
                                    value: 184771037180,
                                    type: codebuild.BuildEnvironmentVariableType.PLAINTEXT
                                },
                                'CDK_DEPLOY_REGION': {
                                    value: 'eu-west-1',
                                    type: codebuild.BuildEnvironmentVariableType.PLAINTEXT
                                },
                                'CDK_ENVIRONMENT': {
                                    value: 'production',
                                    type: codebuild.BuildEnvironmentVariableType.PLAINTEXT
                                }
                            }
                        })
                    ]
                },
                {
                    stageName: 'SelfUpdate',
                    actions: [
                        new codepipeline_actions.CloudFormationCreateUpdateStackAction({
                            actionName: 'Deploy',
                            capabilities: [
                                cfn.CloudFormationCapabilities.ANONYMOUS_IAM
                            ],
                            templatePath: cdkBuildOutput.atPath('CDKPipeline.template.json'),
                            stackName: 'CDKPipeline',
                            deploymentRole: undefined,
                            adminPermissions: false
                        })
                    ]
                },
                {
                    stageName: 'Deploy',
                    actions: [
                        new codepipeline_actions.CloudFormationCreateUpdateStackAction({
                            actionName: 'UpdateBaseStack',
                            runOrder: 1,
                            capabilities: [
                                cfn.CloudFormationCapabilities.ANONYMOUS_IAM
                            ],
                            templatePath: cdkBuildOutput.atPath('BaseStack.template.json'),
                            stackName: 'BaseStack',
                            adminPermissions: false
                        }),
                        ...serviceStackDeployments
                    ]
                }
            ]
        })
    }
}
