import cdk = require('@aws-cdk/core');
import codebuild = require('@aws-cdk/aws-codebuild');
import codepipeline = require('@aws-cdk/aws-codepipeline');
import codepipeline_actions = require('@aws-cdk/aws-codepipeline-actions');
import ecr = require('@aws-cdk/aws-ecr');
import ecs = require('@aws-cdk/aws-ecs');
import s3 = require('@aws-cdk/aws-s3');

interface CicdDockerStackProps extends cdk.StackProps {
    repository: string;
    owner: string;
    branch?: string;
    artifactBucket: s3.IBucket;
}

export class CicdDockerStack extends cdk.Stack {
    public readonly imageRepository: ecr.Repository;

    constructor(scope: cdk.Construct, id: string, props: CicdDockerStackProps) {
        super(scope, id, props);

        const imageRepository = new ecr.Repository(this, 'ImageRepository', {
            removalPolicy: cdk.RemovalPolicy.DESTROY
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
