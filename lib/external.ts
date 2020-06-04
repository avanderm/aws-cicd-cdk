import * as cdk from '@aws-cdk/core';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as s3 from '@aws-cdk/aws-s3';

interface SharedStackProps extends cdk.StackProps {
    artifactBucket: string;
}

export class ExternalResources extends cdk.Stack {
    public readonly artifactBucket: s3.IBucket;
    public readonly vpc: ec2.IVpc;

    constructor(scope: cdk.Construct, id: string, props: SharedStackProps) {
        super(scope, id, props);

        const artifactBucket = s3.Bucket.fromBucketName(this, 'ArtifactBucket;=', props.artifactBucket);

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

        this.artifactBucket = artifactBucket;
        this.vpc = vpc;
    }
}
