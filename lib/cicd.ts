import * as cdk from '@aws-cdk/core';
import * as codebuild from '@aws-cdk/aws-codebuild';
import * as codepipeline from '@aws-cdk/aws-codepipeline';
import * as codepipeline_actions from '@aws-cdk/aws-codepipeline-actions';
import * as ecr from '@aws-cdk/aws-ecr';
import * as ecs from '@aws-cdk/aws-ecs';
import * as s3 from '@aws-cdk/aws-s3';

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
    tag: string;
    // imageRepository: ecr.IRepository;
    imageRepositoryName: string;
    // imageRepositoryName: string,
    ecsServices: Map<string, ecs.FargateService>;
    artifactBucket: s3.IBucket;
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
                privileged: true,
                // environmentVariables: {
                //     'REPOSITORY': {
                //         value: imageRepository.repositoryUri,
                //         type: codebuild.BuildEnvironmentVariableType.PLAINTEXT
                //     }
                // }
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

        const pipeline = new codepipeline.Pipeline(this, 'Pipeline', {
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
