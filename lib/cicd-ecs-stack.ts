import * as cdk from '@aws-cdk/core';
import * as codebuild from '@aws-cdk/aws-codebuild';
import * as codepipeline from '@aws-cdk/aws-codepipeline';
import * as codepipeline_actions from '@aws-cdk/aws-codepipeline-actions';
import * as ecr from '@aws-cdk/aws-ecr';
import * as ecs from '@aws-cdk/aws-ecs';
import * as s3 from '@aws-cdk/aws-s3';
import { createDecipheriv } from 'crypto';

interface CicdEcsStackProps extends cdk.StackProps {
    tag: string;
    // imageRepository: ecr.IRepository;
    imageRepositoryName: string;
    // imageRepositoryName: string,
    ecsServices: Map<string, ecs.FargateService>;
    artifactBucket: s3.IBucket;
}

export class CicdEcsStack extends cdk.Stack {
    constructor(scope: cdk.Construct, id: string, props: CicdEcsStackProps) {
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
