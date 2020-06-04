import * as cdk from '@aws-cdk/core';
import * as cfn from '@aws-cdk/aws-cloudformation';
import * as codebuild from '@aws-cdk/aws-codebuild';
import * as codepipeline from '@aws-cdk/aws-codepipeline';
import * as codepipeline_actions from '@aws-cdk/aws-codepipeline-actions';
import * as ecr from '@aws-cdk/aws-ecr';
import * as ecs from '@aws-cdk/aws-ecs';
import * as iam from '@aws-cdk/aws-iam';
import * as s3 from '@aws-cdk/aws-s3';

export class PipelinePermissions extends cdk.Stack {
    public readonly pipelineDeploymentRole: iam.Role;

    constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        const account = cdk.Stack.of(this).account;
        const region = cdk.Stack.of(this).region;

        // CodePipeline self update
        const ecrPermissions = new iam.PolicyStatement();
        ecrPermissions.addAllResources();
        ecrPermissions.addActions(
            'ecr:CreateRepository',
            'ecr:DeleteRepository',
            'ecr:DescribeRepositories'
        );

        const codebuildPermissions = new iam.PolicyStatement();
        codebuildPermissions.addAllResources();
        codebuildPermissions.addActions(
            'codebuild:CreateProject',
            'codebuild:DeleteProject'
        );

        const codepipelinePermissions = new iam.PolicyStatement();
        codepipelinePermissions.addAllResources();
        codepipelinePermissions.addActions(
            'codepipeline:GetPipeline',
            'codepipeline:UpdatePipeline',
            'codepipeline:DeletePipeline',
            'codepipeline:DeregisterWebhookWithThirdParty',
            'codepipeline:DeleteWebhook',
            'codepipeline:StartPipelineExecution'
        );

        const secretsPermissions = new iam.PolicyStatement();
        secretsPermissions.addResources(`arn:aws:secretsmanager:${region}:${account}:secret:github/hp-antoine/*`);
        secretsPermissions.addActions('secretsmanager:GetSecretValue');

        // General policies
        const cfnPermissions = new iam.PolicyStatement();
        cfnPermissions.addAllResources();
        cfnPermissions.addActions(
            'cloudformation:CreateStack',
            'cloudformation:DeleteStack',
            'cloudformation:UpdateStack'
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

        const pipelineDeploymentRole = new iam.Role(this, 'PipelineDeploymentRole', {
            assumedBy: new iam.ServicePrincipal('cloudformation.amazonaws.com'),
            inlinePolicies: {
                'access': new iam.PolicyDocument({
                    statements: [
                        cfnPermissions,
                        codebuildPermissions,
                        codepipelinePermissions,
                        ecrPermissions,
                        iamPermissions,
                        iamRolePermissions,
                        iamPolicyPermissions,
                        logsPermissions,
                        secretsPermissions,
                    ]
                })
            }
        });

        this.pipelineDeploymentRole = pipelineDeploymentRole;
    }
}

interface DockerStackProps extends cdk.StackProps {
    repository: string;
    owner: string;
    branch?: string;
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
                            branch: props.branch || 'master',
                            oauthToken: cdk.SecretValue.secretsManager('github/hp-antoine/token'),
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
    tag: string;
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
                            imageTag: props.tag
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
    repository: string;
    owner: string;
    branch?: string;
    artifactBucket: s3.IBucket;
    pipelineDeploymentRole: iam.IRole;
}

export class CdkStack extends cdk.Stack {
    constructor(scope: cdk.Construct, id: string, props: CdkStackProps) {
        super(scope, id, props);

        const sourceOutput = new codepipeline.Artifact();
        const buildOutput = new codepipeline.Artifact();

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
                }
            }
        });

        const mainDeployment = new codepipeline_actions.CloudFormationCreateUpdateStackAction({
            actionName: 'Deploy',
            capabilities: [
                cfn.CloudFormationCapabilities.ANONYMOUS_IAM
            ],
            templatePath: buildOutput.atPath('MainStack.template.json'),
            stackName: 'MainStack',
            adminPermissions: false
        })

        new codepipeline.Pipeline(this, 'Pipeline', {
            artifactBucket: props.artifactBucket,
            restartExecutionOnUpdate: true,
            stages: [
                {
                    stageName: 'Source',
                    actions: [
                        new codepipeline_actions.GitHubSourceAction({
                            actionName: 'Source',
                            branch: props.branch || 'master',
                            oauthToken: cdk.SecretValue.secretsManager('github/hp-antoine/token'),
                            output: sourceOutput,
                            owner: props.owner,
                            repo: props.repository,
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
                            outputs: [buildOutput],
                            type: codepipeline_actions.CodeBuildActionType.BUILD
                        })
                    ]
                },
                {
                    stageName: 'Update',
                    actions: [
                        new codepipeline_actions.CloudFormationCreateUpdateStackAction({
                            actionName: 'CdkPipeline',
                            capabilities: [
                                cfn.CloudFormationCapabilities.ANONYMOUS_IAM
                            ],
                            deploymentRole: props.pipelineDeploymentRole,
                            templatePath: buildOutput.atPath('CdkPipeline.template.json'),
                            stackName: 'CdkPipeline',
                            adminPermissions: false,
                            runOrder: 1
                        }),
                        new codepipeline_actions.CloudFormationCreateUpdateStackAction({
                            actionName: 'DockerPipeline',
                            capabilities: [
                                cfn.CloudFormationCapabilities.ANONYMOUS_IAM
                            ],
                            deploymentRole: props.pipelineDeploymentRole,
                            templatePath: buildOutput.atPath('DockerPipeline.template.json'),
                            stackName: 'DockerPipeline',
                            adminPermissions: false,
                            runOrder: 2
                        }),
                        new codepipeline_actions.CloudFormationCreateUpdateStackAction({
                            actionName: 'DeployPipeline',
                            capabilities: [
                                cfn.CloudFormationCapabilities.ANONYMOUS_IAM
                            ],
                            deploymentRole: props.pipelineDeploymentRole,
                            templatePath: buildOutput.atPath('DeployPipeline.template.json'),
                            stackName: 'DeployPipeline',
                            adminPermissions: false,
                            runOrder: 2
                        }),
                    ]
                },
                {
                    stageName: 'Deploy',
                    actions: [
                        mainDeployment
                    ]
                }
            ]
        });

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

        const ec2Permissions = new iam.PolicyStatement();
        ec2Permissions.addAllResources();
        ec2Permissions.addActions(
            'ec2:CreateSecurityGroup',
            'ec2:DeleteSecurityGroup',
            'ec2:DescribeSecurityGroups',
            'ec2:RevokeSecurityGroupEgress',
            'ec2:AuthorizeSecurityGroupEgress'
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

        const sqsPermissions = new iam.PolicyStatement();
        sqsPermissions.addAllResources();
        sqsPermissions.addActions(
            'sqs:CreateQueue',
            'sqs:DeleteQueue',
            'sqs:UpdateQueue'
        );

        mainDeployment.addToDeploymentRolePolicy(iamPermissions);
        mainDeployment.addToDeploymentRolePolicy(iamRolePermissions);
        mainDeployment.addToDeploymentRolePolicy(iamPolicyPermissions);
        mainDeployment.addToDeploymentRolePolicy(logsPermissions);
        mainDeployment.addToDeploymentRolePolicy(ec2Permissions);
        mainDeployment.addToDeploymentRolePolicy(ecsClusterPermissions);
        mainDeployment.addToDeploymentRolePolicy(ecsServicePermissions);
    }
}
