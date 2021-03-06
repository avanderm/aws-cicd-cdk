import * as cdk from '@aws-cdk/core';
import * as cloudwatch from '@aws-cdk/aws-cloudwatch';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as ecr from '@aws-cdk/aws-ecr';
import * as ecs from '@aws-cdk/aws-ecs';
import * as iam from '@aws-cdk/aws-iam';
import * as logs from '@aws-cdk/aws-logs';
import * as s3 from '@aws-cdk/aws-s3';
import * as sqs from '@aws-cdk/aws-sqs';

import { EcsStack } from './cicd';
import { DashboardStack } from './monitoring';

const DEFAULT_ECR_TAG: string = 'latest';

interface QueueServiceProps {
    ageRestriction: number;
    cluster: ecs.Cluster;
    logGroup: logs.LogGroup;
    repository: ecr.Repository;
    tag: string;
}

class QueueService extends cdk.Construct {
    public readonly service: ecs.FargateService;
    public readonly metric: cloudwatch.Metric;

    constructor(scope: cdk.Construct, id: string, props: QueueServiceProps) {
        super(scope, id);

        const queue = new sqs.Queue(this, 'Queue');
        this.metric = queue.metric('ApproximateNumberOfMessagesAvailable');

        const taskRole = new iam.Role(this, 'TaskRole', {
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com')
        });

        queue.grantConsumeMessages(taskRole);
        props.repository.grantPull(taskRole);

        const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
            family: cdk.Stack.of(this).stackName,
            taskRole: taskRole,
            executionRole: taskRole,
            cpu: 256,
            memoryLimitMiB: 1024
        });

        new ecs.ContainerDefinition(this, 'container', {
            command: [
                "main.py"
            ],
            environment: {
                'QUEUE_URL': queue.queueUrl,
                'AGE_RESTRICTION': String(props.ageRestriction)
            },
            image: new ecs.EcrImage(props.repository, props.tag),
            logging: ecs.LogDriver.awsLogs({
                streamPrefix: 'cicd-test',
                logGroup: props.logGroup
            }),
            taskDefinition: taskDefinition
        });

        const service = new ecs.FargateService(this, 'QueueService', {
            cluster: props.cluster,
            taskDefinition: taskDefinition,
            desiredCount: 1
        });

        this.service = service;
    }
}

export interface ServiceProps {
    ageRestriction: number;
    version?: string;
}

interface MainStackProps extends cdk.StackProps {
    artifactBucket: s3.IBucket;
    mappings: Map<string, ServiceProps>;
    repository: ecr.Repository;
    vpc: ec2.IVpc;
}

export class MainStack extends cdk.Stack {
    constructor(scope: cdk.Construct, id: string, props: MainStackProps) {
        super(scope, id, props);

        const cluster = new ecs.Cluster(this, 'Cluster', {
            vpc: props.vpc
        });

        const logGroup = new logs.LogGroup(this, 'LogGroup', {
            logGroupName: '/aws/ecs/cicd-test',
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            retention: 365
        });

        let listeningServices = new Map<string, ecs.BaseService>();
        let metrics = new Array<cloudwatch.Metric>();

        for (let [name, params] of props.mappings) {
            let imageTag = params.version ? params.version : DEFAULT_ECR_TAG;

            let serviceConstruct = new QueueService(this, name, {
                ageRestriction: params.ageRestriction ? params.ageRestriction : 28,
                cluster: cluster,
                logGroup: logGroup,
                repository: props.repository,
                tag: imageTag
            });

            if (imageTag === DEFAULT_ECR_TAG) {
                listeningServices.set(name, serviceConstruct.service);
            }

            metrics.push(serviceConstruct.metric);
        }

        new EcsStack(this, 'DeployPipeline', {
            imageRepositoryName: props.repository.repositoryName,
            ecsServices: listeningServices,
            artifactBucket: props.artifactBucket
        });

        new DashboardStack(this, 'DashboardStack', {
            metrics: metrics
        });
    }
}