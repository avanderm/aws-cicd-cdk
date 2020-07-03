import * as cdk from '@aws-cdk/core';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as s3 from '@aws-cdk/aws-s3';

interface SharedStackProps extends cdk.StackProps {
    artifactBucket: string;
    vpc: string;
    availabilityZones: Array<string>;
    subnets: Array<string>;
}

export class ExternalResources extends cdk.Stack {
    public readonly artifactBucket: s3.IBucket;
    public readonly vpc: ec2.IVpc;

    constructor(scope: cdk.Construct, id: string, props: SharedStackProps) {
        super(scope, id, props);

        const artifactBucket = s3.Bucket.fromBucketName(this, 'ArtifactBucket', props.artifactBucket);

        const vpc = ec2.Vpc.fromVpcAttributes(this, 'VPC', {
            vpcId: props.vpc,
            availabilityZones: props.availabilityZones,
            privateSubnetIds: props.subnets
        });

        this.artifactBucket = artifactBucket;
        this.vpc = vpc;
    }
}
