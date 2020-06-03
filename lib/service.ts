import * as cdk from '@aws-cdk/core';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as ecr from '@aws-cdk/aws-ecr';
import * as ecs from '@aws-cdk/aws-ecs';
import * as iam from '@aws-cdk/aws-iam';
import * as logs from '@aws-cdk/aws-logs';
import * as sqs from '@aws-cdk/aws-sqs';

export class BaseResources extends cdk.Stack {
    public readonly cluster: ecs.Cluster;
    public readonly logGroup: logs.LogGroup;

    constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        const vpc = ec2.Vpc.fromVpcAttributes(this, 'VPC', {
            vpcId: 'vpc-c8bfc0ad',
            availabilityZones: [
                'eu-west-1a',
                'eu-west-1b'
            ],
            privateSubnetIds: [
                'subnet-95406fcd',
                'subnet-4138db26'
            ]
        });

        const cluster = new ecs.Cluster(this, 'Cluster', {
            vpc: vpc
        });
        this.cluster = cluster;

        const logGroup = new logs.LogGroup(this, 'LogGroup', {
            logGroupName: '/aws/ecs/cicd-test',
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            retention: 365
        });
        this.logGroup = logGroup;
    }
}

const DEFAULT_ECR_TAG: string = 'latest';

interface QueueServiceProps extends cdk.StackProps {
    repository: ecr.Repository;
    tag?: string;
    logGroup: logs.LogGroup;
    cluster: ecs.Cluster;
    ageRestriction: number;
}

export class QueueService extends cdk.Stack {
    public readonly service: ecs.FargateService;

    constructor(scope: cdk.Construct, id: string, props: QueueServiceProps) {
        super(scope, id, props);

        const queue = new sqs.Queue(this, 'Queue');

        const taskRole = new iam.Role(this, 'TaskRole', {
            assumedBy: new iam.ServicePrincipal('ecs.amazonaws.com')
        });

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
                "python main.py"
            ],
            environment: {
                'QUEUE_URL': queue.queueUrl,
                'AGE_RESTRICTION': String(props.ageRestriction)
            },
            image: new ecs.EcrImage(props.repository, props.tag ? props.tag : DEFAULT_ECR_TAG),
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