import * as cdk from '@aws-cdk/core';
import * as cfn from '@aws-cdk/aws-cloudformation';
import * as codebuild from '@aws-cdk/aws-codebuild';
import * as codepipeline from '@aws-cdk/aws-codepipeline';
import * as codepipeline_actions from '@aws-cdk/aws-codepipeline-actions';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as ecr from '@aws-cdk/aws-ecr';
import * as ecs from '@aws-cdk/aws-ecs';
import * as iam from '@aws-cdk/aws-iam';
import * as s3 from '@aws-cdk/aws-s3';
import * as service from './service';

import { getSubnetIds, getAvailabilityZones } from './utils';

interface DockerStackProps extends cdk.StackProps {
    repository: string;
    githubTokenParameter: string;
    owner: string;
    branch?: string;
    tag?: string;
    artifactBucket: s3.IBucket;
}

export class DockerStack extends cdk.Stack {
    public readonly imageRepository: ecr.Repository;

    constructor(scope: cdk.Construct, id: string, props: DockerStackProps) {
        super(scope, id, props);

        // updating latest will cause previous images to become untagged
        const imageRepository = new ecr.Repository(this, 'ImageRepository', {
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            lifecycleRules: [
                {
                    description: 'Remove untagged images',
                    maxImageAge: cdk.Duration.days(5),
                    tagStatus: ecr.TagStatus.UNTAGGED
                }
            ]
        });

        const codeTestProject = new codebuild.PipelineProject(this, 'CodeTestProject', {
            buildSpec: codebuild.BuildSpec.fromSourceFilename('buildspec/code-test.yml'),
            environment: {
                buildImage: codebuild.LinuxBuildImage.STANDARD_2_0,
                computeType: codebuild.ComputeType.SMALL,
                privileged: true
            }
        });

        const dockerBuildProject = new codebuild.PipelineProject(this, 'DockerBuildProject', {
            buildSpec: codebuild.BuildSpec.fromSourceFilename('buildspec/docker-build.yml'),
            cache: codebuild.Cache.local(codebuild.LocalCacheMode.DOCKER_LAYER),
            environment: {
                buildImage: codebuild.LinuxBuildImage.STANDARD_2_0,
                computeType: codebuild.ComputeType.SMALL,
                privileged: true,
                environmentVariables: {
                    'REPOSITORY': {
                        value: imageRepository.repositoryName,
                        type: codebuild.BuildEnvironmentVariableType.PLAINTEXT
                    },
                    'REPOSITORY_URI': {
                        value: imageRepository.repositoryUri,
                        type: codebuild.BuildEnvironmentVariableType.PLAINTEXT
                    },
                    'IMAGE_TAG': {
                        value: props.tag ? props.tag : 'latest',
                        type: codebuild.BuildEnvironmentVariableType.PLAINTEXT
                    }
                }
            }
        });

        imageRepository.grantPullPush(dockerBuildProject);

        const sourceOutput = new codepipeline.Artifact();

        new codepipeline.Pipeline(this, 'Pipeline', {
            artifactBucket: props.artifactBucket,
            stages: [
                {
                    stageName: 'Source',
                    actions: [
                        new codepipeline_actions.GitHubSourceAction({
                            actionName: 'Source',
                            branch: props.branch ? props.branch : 'master',
                            oauthToken: cdk.SecretValue.secretsManager(props.githubTokenParameter),
                            output: sourceOutput,
                            owner: props.owner,
                            repo: props.repository,
                            trigger: codepipeline_actions.GitHubTrigger.WEBHOOK
                        })
                    ]
                },
                {
                    stageName: 'Test',
                    actions: [
                        new codepipeline_actions.CodeBuildAction({
                            actionName: 'CodeTest',
                            project: codeTestProject,
                            input: sourceOutput,
                            type: codepipeline_actions.CodeBuildActionType.TEST
                        })
                    ]
                },
                {
                    stageName: 'Build',
                    actions: [
                        new codepipeline_actions.CodeBuildAction({
                            actionName: 'DockerBuild',
                            project: dockerBuildProject,
                            input: sourceOutput,
                            type: codepipeline_actions.CodeBuildActionType.BUILD
                        })
                    ]
                }
            ]
        });

        // exports
        this.imageRepository = imageRepository;
    }
}

interface EcsStackProps extends cdk.StackProps {
    artifactBucket: s3.IBucket;
    ecsServices: Map<string, ecs.FargateService>;
    imageRepositoryName: string;
    tag?: string;
}

export class EcsStack extends cdk.Stack {
    constructor(scope: cdk.Construct, id: string, props: EcsStackProps) {
        super(scope, id, props);

        const imageOutput = new codepipeline.Artifact();
        const buildOutput = new codepipeline.Artifact();

        const buildProject = new codebuild.PipelineProject(this, 'BuildProject', {
            buildSpec: codebuild.BuildSpec.fromObject({
                version: '0.2',
                phases: {
                    install: {
                        runtimeVersions: {
                            nodejs: '12.14'
                        },
                        commands: [
                            'apt-get update',
                            'apt-get install -y jq moreutils',
                            'jq --version'
                        ]
                    },
                    build: {
                        commands: [
                            'cat imageDetail.json | jq \'[{ imageUri: .ImageURI, name: "container" }]\' > imagedefinitions.json'
                        ]
                    }
                },
                artifacts: {
                    files: [
                        'imagedefinitions.json'
                    ]
                }
            }),
            environment: {
                buildImage: codebuild.LinuxBuildImage.STANDARD_4_0,
                computeType: codebuild.ComputeType.SMALL,
                privileged: true
            }
        });

        const serviceDeployments = []
        for (let [name, service] of props.ecsServices) {
            serviceDeployments.push(new codepipeline_actions.EcsDeployAction({
                actionName: name,
                service: service,
                input: buildOutput
            }));
        }

        new codepipeline.Pipeline(this, 'Pipeline', {
            artifactBucket: props.artifactBucket,
            stages: [
                {
                    stageName: 'Source',
                    actions: [
                        new codepipeline_actions.EcrSourceAction({
                            actionName: 'Image',
                            output: imageOutput,
                            repository: ecr.Repository.fromRepositoryName(this, 'Repository', props.imageRepositoryName),
                            imageTag: props.tag ? props.tag : 'latest'
                        })
                    ]
                },
                {
                    stageName: 'Build',
                    actions: [
                        new codepipeline_actions.CodeBuildAction({
                            actionName: 'Build',
                            project: buildProject,
                            input: imageOutput,
                            outputs: [buildOutput],
                            type: codepipeline_actions.CodeBuildActionType.BUILD
                        })
                    ]
                },
                {
                    stageName: 'Deploy',
                    actions: serviceDeployments
                }
            ]
        });
    }
}

interface CdkStackProps extends cdk.StackProps {
    cdkRepositoryName: string;
    dockerRepositoryName: string;
    githubTokenParameter: string;
    owner: string;
    branch?: string;
    artifactBucket: s3.IBucket;
    vpc: ec2.IVpc;
    serviceStacks: Array<service.QueueServiceStack>;
    environment?: string;
}

export class CdkStack extends cdk.Stack {
    constructor(scope: cdk.Construct, id: string, props: CdkStackProps) {
        super(scope, id, props);

        const account = cdk.Stack.of(this).account;
        const region = cdk.Stack.of(this).region;

        const sourceOutput = new codepipeline.Artifact();
        const cdkOutput = new codepipeline.Artifact('cdkOutput');
        const configOutput = new codepipeline.Artifact('configOutput');

        const buildProject = new codebuild.PipelineProject(this, 'BuildProject', {
            buildSpec: codebuild.BuildSpec.fromSourceFilename('buildspec.yml'),
            environment: {
                buildImage: codebuild.LinuxBuildImage.STANDARD_4_0,
                computeType: codebuild.ComputeType.SMALL,
                environmentVariables: {
                    'BUILD_DIR': {
                        value: 'build',
                        type: codebuild.BuildEnvironmentVariableType.PLAINTEXT
                    },
                    'CDK_REPOSITORY': {
                        value: props.cdkRepositoryName,
                        type: codebuild.BuildEnvironmentVariableType.PLAINTEXT
                    },
                    'DOCKER_REPOSITORY': {
                        value: props.dockerRepositoryName,
                        type: codebuild.BuildEnvironmentVariableType.PLAINTEXT
                    },
                    'GITHUB_TOKEN': {
                        value: props.githubTokenParameter,
                        type: codebuild.BuildEnvironmentVariableType.PLAINTEXT
                    },
                    'GITHUB_OWNER': {
                        value: props.owner,
                        type: codebuild.BuildEnvironmentVariableType.PLAINTEXT
                    },
                    'ARTIFACT_BUCKET': {
                        value: props.artifactBucket.bucketName,
                        type: codebuild.BuildEnvironmentVariableType.PLAINTEXT
                    },
                    'VPC_ID': {
                        value: props.vpc.vpcId,
                        type: codebuild.BuildEnvironmentVariableType.PLAINTEXT
                    },
                    'SUBNET_IDS': {
                        value: getSubnetIds(props.vpc).join(','),
                        type: codebuild.BuildEnvironmentVariableType.PLAINTEXT
                    },
                    'AVAILABILITY_ZONES': {
                        value: getAvailabilityZones(props.vpc).join(','),
                        type: codebuild.BuildEnvironmentVariableType.PLAINTEXT
                    },
                    'ENVIRONMENT': {
                        value: props.environment ? props.environment : 'production',
                        type: codebuild.BuildEnvironmentVariableType.PLAINTEXT
                    },
                }
            }
        });

        const cloudwatchPermissions = new iam.PolicyStatement();
        cloudwatchPermissions.addAllResources();
        cloudwatchPermissions.addActions(
            'cloudwatch:GetDashboard',
            'cloudwatch:PutDashboard',
            'cloudwatch:DeleteDashboards',
        );

        const codebuildPermissions = new iam.PolicyStatement();
        codebuildPermissions.addAllResources();
        codebuildPermissions.addActions(
            'codebuild:BatchGetProjects',
            'codebuild:CreateProject',
            'codebuild:DeleteProject',
            'codebuild:UpdateProject',
        );

        const codepipelinePermissions = new iam.PolicyStatement();
        codepipelinePermissions.addAllResources();
        codepipelinePermissions.addActions(
            'codepipeline:CreatePipeline',
            'codepipeline:GetPipeline',
            'codepipeline:GetPipelineState',
            'codepipeline:DeletePipeline',
            'codepipeline:DeleteWebhook',
            'codepipeline:DeregisterWebhookWithThirdParty',
            'codepipeline:PutWebhook',
            'codepipeline:RegisterWebhookWithThirdParty',
            'codepipeline:StartPipelineExecution',
            'codepipeline:UpdatePipeline',
        );

        const ec2Permissions = new iam.PolicyStatement();
        ec2Permissions.addAllResources();
        ec2Permissions.addActions(
            'ec2:CreateSecurityGroup',
            'ec2:DeleteSecurityGroup',
            'ec2:DescribeSecurityGroups',
            'ec2:RevokeSecurityGroupEgress',
            'ec2:AuthorizeSecurityGroupEgress'
        );

        const ecrPermissions = new iam.PolicyStatement();
        ecrPermissions.addAllResources();
        ecrPermissions.addActions(
            'ecr:CreateRepository',
            'ecr:DeleteRepository',
            'ecr:DeleteRepositoryPolicy',
            'ecr:DescribeRepositories',
            'ecr:PutLifeCyclePolicy'
        );

        const ecsClusterPermissions = new iam.PolicyStatement();
        ecsClusterPermissions.addAllResources();
        ecsClusterPermissions.addActions(
            'ecs:CreateCluster',
            'ecs:DeleteCluster',
            'ecs:DescribeClusters'
        );

        const ecsServicePermissions = new iam.PolicyStatement();
        ecsServicePermissions.addAllResources();
        ecsServicePermissions.addActions(
            'ecs:CreateService',
            'ecs:DeleteService',
            'ecs:UpdateService',
            'ecs:DescribeServices',
            'ecs:RegisterTaskDefinition',
            'ecs:DeregisterTaskDefinition'
        );

        const eventsPermissions = new iam.PolicyStatement();
        eventsPermissions.addAllResources();
        eventsPermissions.addActions(
            'events:CreateRule',
            'events:DeleteRule',
            'events:DescribeRule',
            'events:PutTargets',
            'events:PutRule',
            'events:RemoveTargets',
        );

        const iamPermissions = new iam.PolicyStatement();
        iamPermissions.addAllResources();
        iamPermissions.addActions(
            'iam:PassRole',
            'iam:UpdateAssumeRolePolicy'
        );

        const iamRolePermissions = new iam.PolicyStatement();
        iamRolePermissions.addAllResources();
        iamRolePermissions.addActions(
            'iam:CreateRole',
            'iam:DeleteRole',
            'iam:GetRole'
        );

        const iamPolicyPermissions = new iam.PolicyStatement();
        iamPolicyPermissions.addAllResources();
        iamPolicyPermissions.addActions(
            'iam:PutRolePolicy',
            'iam:AttachRolePolicy',
            'iam:DetachRolePolicy',
            'iam:DeleteRolePolicy',
            'iam:GetRolePolicy'
        );

        const logsPermissions = new iam.PolicyStatement();
        logsPermissions.addAllResources();
        logsPermissions.addActions(
            'logs:CreateLogGroup',
            'logs:DeleteLogGroup',
            'logs:DescribeLogGroups',
            'logs:PutRetentionPolicy'
        );

        const secretsPermissions = new iam.PolicyStatement();
        secretsPermissions.addResources(`arn:aws:secretsmanager:${region}:${account}:secret:github/hp-antoine/*`);
        secretsPermissions.addActions('secretsmanager:GetSecretValue');

        const sqsPermissions = new iam.PolicyStatement();
        sqsPermissions.addAllResources();
        sqsPermissions.addActions(
            'sqs:CreateQueue',
            'sqs:DeleteQueue',
            'sqs:GetQueueAttributes',
            'sqs:UpdateQueue'
        );

        const tagPermissions = new iam.PolicyStatement();
        tagPermissions.addAllResources();
        tagPermissions.addActions(
            'codepipeline:ListTagsForResource',
            'codepipeline:TagResource',
            'codepipeline:UntagResource',
            'ec2:CreateTags',
            'ec2:DeleteTags',
            'ecr:TagResource',
            'ecr:ListTagsForResource',
            'ecr:UntagResource',
            'ecs:ListTagsForResource',
            'ecs:TagResource',
            'ecs:UntagResource',
            'iam:TagRole',
            'iam:UntagRole',
            'sqs:TagQueue',
            'sqs:UntagQueue',
            'tag:TagResources',
            'tag:UntagResources',
        );

        buildProject.addToRolePolicy(tagPermissions);

        const selfDeploymentRole = new iam.Role(this, 'TaskRole', {
            assumedBy: new iam.ServicePrincipal('cloudformation.amazonaws.com'),
            inlinePolicies: {
                'self-destruct': new iam.PolicyDocument({
                    statements: [
                        iamRolePermissions,
                        iamPolicyPermissions
                    ]
                })
            }
        });

        const roleResource = selfDeploymentRole.node.findChild('Resource') as cdk.CfnResource;
        const otherRoleResource = buildProject.role?.node.findChild('Resource') as cdk.CfnResource;
        otherRoleResource.addDependsOn(roleResource);

        selfDeploymentRole.addToPolicy(iamPermissions);
        selfDeploymentRole.addToPolicy(codebuildPermissions);
        selfDeploymentRole.addToPolicy(codepipelinePermissions);
        selfDeploymentRole.addToPolicy(tagPermissions);

        const selfDeployment = new codepipeline_actions.CloudFormationCreateUpdateStackAction({
            actionName: 'CdkPipeline',
            capabilities: [
                cfn.CloudFormationCapabilities.ANONYMOUS_IAM
            ],
            deploymentRole: selfDeploymentRole,
            templatePath: cdkOutput.atPath('CdkPipeline.template.json'),
            templateConfiguration: configOutput.atPath('basicConfiguration.json'),
            stackName: 'CdkPipeline',
            adminPermissions: false,
            runOrder: 1
        });

        const dockerDeployment = new codepipeline_actions.CloudFormationCreateUpdateStackAction({
            actionName: 'DockerPipeline',
            capabilities: [
                cfn.CloudFormationCapabilities.ANONYMOUS_IAM
            ],
            templatePath: cdkOutput.atPath('DockerPipeline.template.json'),
            templateConfiguration: configOutput.atPath('basicConfiguration.json'),
            stackName: 'DockerPipeline',
            adminPermissions: false,
            runOrder: 1
        });

        const baseDeployment = new codepipeline_actions.CloudFormationCreateUpdateStackAction({
            actionName: 'BaseStack',
            capabilities: [
                cfn.CloudFormationCapabilities.ANONYMOUS_IAM
            ],
            templatePath: cdkOutput.atPath('BaseStack.template.json'),
            templateConfiguration: configOutput.atPath('basicConfiguration.json'),
            stackName: 'BaseStack',
            adminPermissions: false,
            runOrder: 2
        });

        const serviceStackDeploymentRole = new iam.Role(this, 'ServiceStackDeploymentRole', {
            assumedBy: new iam.ServicePrincipal('cloudformation.amazonaws.com')
        });

        let serviceStackDeployments = new Array<codepipeline_actions.CloudFormationCreateUpdateStackAction>();

        for (let stack of props.serviceStacks) {
            serviceStackDeployments.push(new codepipeline_actions.CloudFormationCreateUpdateStackAction({
                actionName: `Update${stack}`,
                capabilities: [
                    cfn.CloudFormationCapabilities.ANONYMOUS_IAM
                ],
                runOrder: stack.useLatest ? 3 : 5,
                templatePath: cdkOutput.atPath(`${stack.stackName}.template.json`),
                templateConfiguration: configOutput.atPath('basicConfiguration.json'),
                stackName: stack.stackName,
                deploymentRole: serviceStackDeploymentRole,
                adminPermissions: false
            }));
        }

        const ecsDeployment = new codepipeline_actions.CloudFormationCreateUpdateStackAction({
            actionName: 'DeployPipeline',
            capabilities: [
                cfn.CloudFormationCapabilities.ANONYMOUS_IAM
            ],
            templatePath: cdkOutput.atPath('DeployPipeline.template.json'),
            templateConfiguration: configOutput.atPath('basicConfiguration.json'),
            stackName: 'DeployPipeline',
            adminPermissions: false,
            runOrder: 4
        });

        const dashboardDeployment = new codepipeline_actions.CloudFormationCreateUpdateStackAction({
            actionName: 'DashboardStack',
            capabilities: [
                cfn.CloudFormationCapabilities.ANONYMOUS_IAM
            ],
            templatePath: cdkOutput.atPath('DashboardStack.template.json'),
            templateConfiguration: configOutput.atPath('basicConfiguration.json'),
            stackName: 'DashboardStack',
            adminPermissions: false,
            runOrder: 6
        });

        new codepipeline.Pipeline(this, 'Pipeline', {
            artifactBucket: props.artifactBucket,
            restartExecutionOnUpdate: true,
            stages: [
                {
                    stageName: 'Source',
                    actions: [
                        new codepipeline_actions.GitHubSourceAction({
                            actionName: 'Source',
                            branch: props.branch ? props.branch : 'master',
                            oauthToken: cdk.SecretValue.secretsManager('github/hp-antoine/token'),
                            output: sourceOutput,
                            owner: props.owner,
                            repo: props.cdkRepositoryName,
                            trigger: codepipeline_actions.GitHubTrigger.WEBHOOK
                        })
                    ]
                },
                {
                    stageName: 'Build',
                    actions: [
                        new codepipeline_actions.CodeBuildAction({
                            actionName: 'CloudFormationBuild',
                            project: buildProject,
                            input: sourceOutput,
                            outputs: [cdkOutput, configOutput],
                            type: codepipeline_actions.CodeBuildActionType.BUILD
                        })
                    ]
                },
                {
                    stageName: 'Update',
                    actions: [
                        selfDeployment,
                    ]
                },
                {
                    stageName: 'Deploy',
                    actions: [
                        dockerDeployment,
                        baseDeployment,
                        ...serviceStackDeployments,
                        ecsDeployment,
                        dashboardDeployment
                    ]
                }
            ]
        });

        dockerDeployment.addToDeploymentRolePolicy(codebuildPermissions);
        dockerDeployment.addToDeploymentRolePolicy(codepipelinePermissions);
        dockerDeployment.addToDeploymentRolePolicy(ecrPermissions);
        dockerDeployment.addToDeploymentRolePolicy(iamPermissions);
        dockerDeployment.addToDeploymentRolePolicy(iamPolicyPermissions);
        dockerDeployment.addToDeploymentRolePolicy(iamRolePermissions);
        dockerDeployment.addToDeploymentRolePolicy(secretsPermissions);
        dockerDeployment.addToDeploymentRolePolicy(tagPermissions);

        baseDeployment.addToDeploymentRolePolicy(ecsClusterPermissions);
        baseDeployment.addToDeploymentRolePolicy(cloudwatchPermissions);
        baseDeployment.addToDeploymentRolePolicy(codebuildPermissions);
        baseDeployment.addToDeploymentRolePolicy(codepipelinePermissions);
        baseDeployment.addToDeploymentRolePolicy(eventsPermissions);
        baseDeployment.addToDeploymentRolePolicy(iamPermissions);
        baseDeployment.addToDeploymentRolePolicy(iamRolePermissions);
        baseDeployment.addToDeploymentRolePolicy(iamPolicyPermissions);
        baseDeployment.addToDeploymentRolePolicy(logsPermissions);
        baseDeployment.addToDeploymentRolePolicy(tagPermissions);

        selfDeployment.addToDeploymentRolePolicy(codebuildPermissions);
        selfDeployment.addToDeploymentRolePolicy(codepipelinePermissions);
        selfDeployment.addToDeploymentRolePolicy(iamPolicyPermissions);
        selfDeployment.addToDeploymentRolePolicy(iamRolePermissions);
        selfDeployment.addToDeploymentRolePolicy(secretsPermissions);
        selfDeployment.addToDeploymentRolePolicy(tagPermissions);

        serviceStackDeploymentRole.addToPolicy(ec2Permissions);
        serviceStackDeploymentRole.addToPolicy(ecsServicePermissions);
        serviceStackDeploymentRole.addToPolicy(iamPermissions);
        serviceStackDeploymentRole.addToPolicy(iamRolePermissions);
        serviceStackDeploymentRole.addToPolicy(iamPolicyPermissions);
        serviceStackDeploymentRole.addToPolicy(sqsPermissions);
        serviceStackDeploymentRole.addToPolicy(tagPermissions);

        ecsDeployment.addToDeploymentRolePolicy(codebuildPermissions);
        ecsDeployment.addToDeploymentRolePolicy(codepipelinePermissions);
        ecsDeployment.addToDeploymentRolePolicy(eventsPermissions);
        ecsDeployment.addToDeploymentRolePolicy(iamPermissions);
        ecsDeployment.addToDeploymentRolePolicy(iamRolePermissions);
        ecsDeployment.addToDeploymentRolePolicy(iamPolicyPermissions);
        ecsDeployment.addToDeploymentRolePolicy(tagPermissions);

        dashboardDeployment.addToDeploymentRolePolicy(cloudwatchPermissions);
        dashboardDeployment.addToDeploymentRolePolicy(iamPermissions);
        dashboardDeployment.addToDeploymentRolePolicy(tagPermissions);
    }
}
