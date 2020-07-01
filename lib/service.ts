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

interface QueueServiceStackProps extends cdk.StackProps {
    cluster: ecs.Cluster;
    logGroup: logs.LogGroup;
    parameters: ServiceProps;
    repository: ecr.Repository;
}

export class QueueServiceStack extends cdk.Stack {
    public readonly service: ecs.BaseService;
    public readonly metric: cloudwatch.Metric;
    public readonly useLatest: boolean;

    constructor(scope: cdk.Construct, id: string, props: QueueServiceStackProps) {
        super(scope, id, props);

        let imageTag = props.parameters.version ? props.parameters.version : DEFAULT_ECR_TAG;

        let serviceConstruct = new QueueService(this, 'QueueService', {
            ageRestriction: props.parameters.ageRestriction ? props.parameters.ageRestriction : 28,
            cluster: props.cluster,
            logGroup: props.logGroup,
            repository: props.repository,
            tag: imageTag
        });

        this.service = serviceConstruct.service;
        this.metric = serviceConstruct.metric;
        this.useLatest = (imageTag === DEFAULT_ECR_TAG);
    }
}

interface BaseStackProps extends cdk.StackProps {
    artifactBucket: s3.IBucket;
    vpc: ec2.IVpc;
}

export class BaseStack extends cdk.Stack {
    public readonly cluster: ecs.Cluster;
    public readonly logGroup: logs.LogGroup;

    constructor(scope: cdk.Construct, id: string, props: BaseStackProps) {
        super(scope, id, props);

        const cluster = new ecs.Cluster(this, 'Cluster', {
            vpc: props.vpc
        });

        const logGroup = new logs.LogGroup(this, 'LogGroup', {
            logGroupName: '/aws/ecs/cicd-test',
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            retention: 365
        });

        this.cluster = cluster;
        this.logGroup = logGroup;
    }
}