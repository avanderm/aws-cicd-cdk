import cdk = require('@aws-cdk/core');
import s3 = require('@aws-cdk/aws-s3');

interface SharedStackProps extends cdk.StackProps {
    artifactBucket: string;
}

export class SharedStack extends cdk.Stack {
    public readonly artifactBucket: s3.IBucket;

    constructor(scope: cdk.Construct, id: string, props: SharedStackProps) {
        super(scope, id, props);

        const artifactBucket = s3.Bucket.fromBucketName(this, 'ArtifactBucket;=', props.artifactBucket);

        this.artifactBucket = artifactBucket;
    }
}
